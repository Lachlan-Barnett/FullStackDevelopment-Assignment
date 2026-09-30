const fs = require('fs');
const path = require('path');
const { scenario } = require('./helpers');

// Adds a new user to group 1 (via a join request the admin approves) and returns their token.
async function addMember({ call, signup, login }, email, username, birthdate = '1990-01-01') {
  const token = await signup(email, username, birthdate);
  const U1 = await login('user1@com.au');
  const jr = await call(`${username} asks to join`, 200, 'POST', '/groups/1/join-requests', token, {});
  await call(`${username} is let in`, 200, 'PUT', `/groups/1/join-requests/${jr.body.id}`, U1, { approve: true });
  return token;
}

scenario('Group deletion requests', async (ctx) => {
  const { check, call, login, signup, sendFile, connect, ask, tinyPng, db, uploadsDir } = ctx;
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');

  // Put content in group 1: messages, an image, a pending join request and a pending room request.
  const s = await connect(U1);
  await ask(s, 'room:join', { roomId: 1 });
  await ask(s, 'message:send', { roomId: 1, type: 'text', content: 'bye' });
  const up = await sendFile('POST', '/rooms/1/images', U1, tinyPng());
  await ask(s, 'message:send', { roomId: 1, type: 'image', content: up.body.url });
  const imageFile = path.join(uploadsDir, path.basename(up.body.url));
  await call('outsider asks to join', 200, 'POST', '/groups/1/join-requests', await signup('o@t.com', 'o'), {});
  await call('member requests a room', 200, 'POST', '/groups/1/room-requests', U2, { name: 'pending-room' });

  await call("members can't request deletion", 403, 'POST', '/groups/1/delete-requests', U2, { reason: 'x' });
  await call("the super admin can't request it (not a group admin)", 403, 'POST', '/groups/1/delete-requests', SA, {});
  await call("group admins can't see the super admin's list", 403, 'GET', '/admin/group-delete-requests', U1);

  let r = await call('group admin requests deletion', 200, 'POST', '/groups/1/delete-requests', U1, { reason: '  nobody uses it  ' });
  check('the request keeps the group name and trimmed reason', r.body.status === 'pending' && r.body.reason === 'nobody uses it' && r.body.groupName === 'help');
  const first = r.body.id;
  await call('only one pending request per group', 409, 'POST', '/groups/1/delete-requests', U1, {});
  r = await call('admin sees their request', 200, 'GET', '/groups/1/delete-requests', U1);
  check('the request shows as pending', r.body[0]?.status === 'pending');
  r = await call('super admin lists requests', 200, 'GET', '/admin/group-delete-requests', SA);
  check('the list names who asked', r.body.length === 1 && r.body[0].requesterName === 'user1');

  r = await call('super admin rejects with a reason', 200, 'PUT', `/admin/group-delete-requests/${first}`, SA, { approve: false, reason: 'still active' });
  check('the rejection reason is saved', r.body.status === 'rejected' && r.body.rejectionReason === 'still active');
  check('the group still exists after a rejection', !!(await db.collection('groups').findOne({ id: 1 })));
  await call("can't action twice", 409, 'PUT', `/admin/group-delete-requests/${first}`, SA, { approve: true });
  const second = (await call('admin can ask again after a rejection', 200, 'POST', '/groups/1/delete-requests', U1, {})).body.id;

  await call('super admin approves', 200, 'PUT', `/admin/group-delete-requests/${second}`, SA, { approve: true });
  check('the group is deleted', !(await db.collection('groups').findOne({ id: 1 })));
  check('its rooms are deleted', (await db.collection('rooms').countDocuments({ groupId: 1 })) === 0);
  check('its messages are deleted', (await db.collection('messages').countDocuments({ roomId: 1 })) === 0);
  check('its image files are deleted', !fs.existsSync(imageFile));
  check('pending join requests are deleted', (await db.collection('joinRequests').countDocuments({ groupId: 1, status: 'pending' })) === 0);
  check('pending room requests are deleted', (await db.collection('roomRequests').countDocuments({ groupId: 1, status: 'pending' })) === 0);
  r = await call('groups list', 200, 'GET', '/groups', U1);
  check('the group is no longer listed', !r.body.some((g) => g.id === 1));
  await call('the group returns 404', 404, 'GET', '/groups/1', U1);
  r = await ask(s, 'message:send', { roomId: 1, type: 'text', content: 'still here?' });
  check('chatting in a deleted room is refused', !r.ok);
});

scenario('Reports and group bans', async (ctx) => {
  const { check, call, login, connect, ask, db } = ctx;
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const carol = await addMember(ctx, 'c@t.com', 'carol');

  await call("members can't see reports", 403, 'GET', '/groups/1/reports', U2);
  const rep = await call('carol reports user2', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user2', reason: 'spamming' });
  let r = await call('admin sees reports', 200, 'GET', '/groups/1/reports', U1);
  check('reports name the reporter and the reported user', r.body[0]?.reporterName === 'carol' && r.body[0]?.reportedName === 'user2');
  await call('unknown actions are refused', 400, 'PUT', `/groups/1/reports/${rep.body.id}`, U1, { action: 'nuke' });
  await call("members can't act on reports", 403, 'PUT', `/groups/1/reports/${rep.body.id}`, U2, { action: 'ban' });

  const s2 = await connect(U2);
  check('user2 is in the room before the ban', (await ask(s2, 'room:join', { roomId: 1 })).ok);
  r = await call('admin bans user2', 200, 'PUT', `/groups/1/reports/${rep.body.id}`, U1, { action: 'ban' });
  check('the report is marked actioned', r.body.status === 'actioned');
  const group = await db.collection('groups').findOne({ id: 1 });
  check('the banned user is removed from the group', !group.members.some((m) => m.userId === 3));
  check("the banned user is on the group's ban list", group.bannedUserIds.includes(3));
  const ban = await db.collection('bans').findOne({ userId: 3, groupId: 1 });
  check('a ban record is saved with the report and admin', ban && ban.scope === 'group' && ban.reportId === rep.body.id && ban.issuedBy === 2);
  await call("can't act on a report twice", 409, 'PUT', `/groups/1/reports/${rep.body.id}`, U1, { action: 'ban' });

  r = await ask(s2, 'message:send', { roomId: 1, type: 'text', content: 'am I still here?' });
  check("a banned user can't chat in the group", !r.ok);
  await call("a banned user can't see the rooms", 403, 'GET', '/groups/1/rooms', U2);
  r = await call("a banned user can't ask to rejoin", 403, 'POST', '/groups/1/join-requests', U2, {});
  check('they are told why', r.body.message === 'You are banned from this group');
  const g1 = (await call('groups list for the banned user', 200, 'GET', '/groups', U2)).body.find((g) => g.id === 1);
  check('the banned user sees isBanned', g1.isBanned === true);
  check('the full ban list is never sent', !('bannedUserIds' in g1));
  check('other users see isBanned false', (await call('groups list', 200, 'GET', '/groups', U1)).body.find((g) => g.id === 1).isBanned === false);

  const rep2 = await call('carol reports user1', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user1', reason: 'rude' });
  r = await call('admin dismisses a report', 200, 'PUT', `/groups/1/reports/${rep2.body.id}`, U1, { action: 'dismiss' });
  check('the report is marked dismissed', r.body.status === 'dismissed');

  await call('carol is promoted', 200, 'PUT', '/groups/1/members/4/role', U1, { role: 'admin' });
  const carolAdmin = await login('c@t.com', 'p');
  const rep3 = await call('carol reports user1 again', 200, 'POST', '/reports', carolAdmin, { groupId: 1, username: 'user1', reason: 'abuse' });
  r = await call("an admin can't act on their own report", 403, 'PUT', `/groups/1/reports/${rep3.body.id}`, carolAdmin, { action: 'ban' });
  check('the reason is given', /another admin/i.test(r.body.message));
  await call("admins can't be banned (demote first)", 409, 'PUT', `/groups/1/reports/${rep3.body.id}`, U1, { action: 'ban' });
});

scenario('Banned members list', async (ctx) => {
  const { check, call, login } = ctx;
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');

  let r = await call('admin sees an empty list at first', 200, 'GET', '/groups/1/banned', U1);
  check('the list starts empty', Array.isArray(r.body) && r.body.length === 0);
  await call("members can't see the banned list", 403, 'GET', '/groups/1/banned', U2);
  await call("the super admin (not a group admin) can't either", 403, 'GET', '/groups/1/banned', SA);

  const carol = await addMember(ctx, 'c@t.com', 'carol');
  const rep = await call('carol reports user2', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user2', reason: 'spamming' });
  await call('user2 is banned', 200, 'PUT', `/groups/1/reports/${rep.body.id}`, U1, { action: 'ban' });
  const dave = await addMember(ctx, 'd@t.com', 'dave');
  void dave;
  const rep2 = await call('carol reports dave', 200, 'POST', '/reports', carol, { groupId: 1, username: 'dave', reason: 'trolling' });
  await call('dave is banned', 200, 'PUT', `/groups/1/reports/${rep2.body.id}`, U1, { action: 'ban' });

  r = await call('admin reads the list', 200, 'GET', '/groups/1/banned', U1);
  check('both bans are listed, newest first', r.body.length === 2 && r.body[0].username === 'dave' && r.body[1].username === 'user2');
  const b = r.body[1];
  check('each entry says when, by whom and why', !isNaN(Date.parse(b.bannedAt)) && b.bannedByName === 'user1' && b.reason === 'spamming');
  check('no email addresses are exposed', !JSON.stringify(r.body).includes('@'));
});

scenario('Removing a user from Fabulari', async (ctx) => {
  const { check, call, api, login, sendFile, tinyPng, db, uploadsDir } = ctx;
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const carol = await addMember(ctx, 'c@t.com', 'carol');
  await sendFile('PUT', '/users/3/photo', U2, tinyPng()); // user2 has a profile photo

  const rep = await call('carol reports user2', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user2', reason: 'harassment' });
  await call("members can't escalate reports", 403, 'POST', `/groups/1/reports/${rep.body.id}/escalate`, U2, {});
  let r = await call('admin asks the super admin to remove user2', 200, 'POST', `/groups/1/reports/${rep.body.id}/escalate`, U1, {});
  check('the request records who and their email', r.body.status === 'pending' && r.body.username === 'user2' && r.body.email === 'user2@com.au');
  const request = r.body.id;
  check('the report is marked escalated', (await db.collection('reports').findOne({ id: rep.body.id })).status === 'escalated');
  r = await call('reports list', 200, 'GET', '/groups/1/reports', U1);
  check('an escalated report leaves the pending list', r.body.length === 0);
  const rep2 = await call('another report about user2', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user2', reason: 'again' });
  await call('only one removal request per user at a time', 409, 'POST', `/groups/1/reports/${rep2.body.id}/escalate`, U1, {});

  await call("group admins can't see removal requests", 403, 'GET', '/admin/system-ban-requests', U1);
  r = await call('super admin lists removal requests', 200, 'GET', '/admin/system-ban-requests', SA);
  check('the list shows who asked and why', r.body.length === 1 && r.body[0].requesterName === 'user1' && r.body[0].reason === 'harassment');

  await call('super admin approves', 200, 'PUT', `/admin/system-ban-requests/${request}`, SA, { approve: true });
  check('the account is deleted', !(await db.collection('users').findOne({ id: 3 })));
  check('they are removed from their groups', !(await db.collection('groups').findOne({ id: 1 })).members.some((m) => m.userId === 3));
  check('their profile photo file is deleted', !fs.existsSync(path.join(uploadsDir, 'avatars', '3.png')));
  check('a system ban is recorded', !!(await db.collection('bans').findOne({ userId: 3, scope: 'system' })));
  await call('their existing login stops working', 401, 'GET', '/groups', U2);
  r = await api('POST', '/auth', null, { email: 'user2@com.au', password: '123' });
  check("they can't log in", r.body.valid === false);
  r = await call("their email can't sign up again", 403, 'POST', '/signup', null, { email: 'user2@com.au', username: 'back', password: 'x' });
  check('they are told the email is banned', /banned/.test(r.body.message));
  await call('the email block ignores capitals', 403, 'POST', '/signup', null, { email: 'USER2@COM.AU', username: 'back', password: 'x' });
  await call("can't action twice", 409, 'PUT', `/admin/system-ban-requests/${request}`, SA, { approve: true });

  await addMember(ctx, 'd@t.com', 'dave');
  const rep4 = await call('carol reports dave', 200, 'POST', '/reports', carol, { groupId: 1, username: 'dave', reason: 'minor' });
  const req4 = (await call('admin escalates', 200, 'POST', `/groups/1/reports/${rep4.body.id}/escalate`, U1, {})).body.id;
  r = await call('super admin rejects', 200, 'PUT', `/admin/system-ban-requests/${req4}`, SA, { approve: false, reason: 'a group ban is enough' });
  check('the rejection reason is saved', r.body.status === 'rejected' && r.body.rejectionReason === 'a group ban is enough');
  check('a rejected user keeps their account', !!(await db.collection('users').findOne({ email: 'd@t.com' })));

  // A group's only admin can't be removed until another admin is promoted.
  const rep5 = await call('carol reports user1', 200, 'POST', '/reports', carol, { groupId: 1, username: 'user1', reason: 'bad admin' });
  const req5 = (await call('user1 escalates it', 200, 'POST', `/groups/1/reports/${rep5.body.id}/escalate`, U1, {})).body.id;
  r = await call("the only admin can't be removed", 409, 'PUT', `/admin/system-ban-requests/${req5}`, SA, { approve: true });
  check('the error names the group', /only admin of "help"/.test(r.body.message));
  check('the only admin still exists', !!(await db.collection('users').findOne({ id: 2 })));
  await call('carol is promoted', 200, 'PUT', '/groups/1/members/4/role', U1, { role: 'admin' });
  await call('removal works once another admin exists', 200, 'PUT', `/admin/system-ban-requests/${req5}`, SA, { approve: true });
  check('the group still has an admin', (await db.collection('groups').findOne({ id: 1 })).members.some((m) => m.role === 'admin'));

  // The super admin can never be removed. (They're never in groups, so plant a report filed by dave.)
  const carolAdmin = await login('c@t.com', 'p');
  const daveId = (await db.collection('users').findOne({ email: 'd@t.com' })).id;
  await db.collection('reports').insertOne({ id: 999, reportedUserId: 1, reportedBy: daveId, groupId: 1, reason: 'x', status: 'pending', createdAt: '' });
  r = await call("the super admin can't be removed", 403, 'POST', '/groups/1/reports/999/escalate', carolAdmin, {});
  check('the reason is given', r.body.message === 'The super admin cannot be removed');
});
