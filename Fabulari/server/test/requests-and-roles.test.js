const { scenario } = require('./helpers');

scenario('Join requests and the age limit', async ({ check, call, login, signup }) => {
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const KID = await signup('kid@t.com', 'kid', '2015-06-01');
  const ADULT = await signup('ad@t.com', 'adult', '1995-06-01');

  let r = await call('under-age user can apply', 200, 'POST', '/groups/1/join-requests', KID, {});
  check('under-age request is rejected automatically', r.body.status === 'rejected' && /13 or older/.test(r.body.rejectionReason));
  r = await call('adult can apply', 200, 'POST', '/groups/1/join-requests', ADULT, {});
  const requestId = r.body.id;
  check('adult request is pending', r.body.status === 'pending');
  await call("can't apply twice", 409, 'POST', '/groups/1/join-requests', ADULT, {});
  await call("members can't apply", 409, 'POST', '/groups/1/join-requests', U2, {});
  await call("members can't see join requests", 403, 'GET', '/groups/1/join-requests', U2);
  r = await call('group admin sees join requests', 200, 'GET', '/groups/1/join-requests', U1);
  check('join requests include usernames', r.body.some((x) => x.username === 'adult'));
  await call('admin approves', 200, 'PUT', `/groups/1/join-requests/${requestId}`, U1, { approve: true });
  await call("can't approve twice", 409, 'PUT', `/groups/1/join-requests/${requestId}`, U1, { approve: true });
  await call('new member can see rooms', 200, 'GET', '/groups/1/rooms', ADULT);
  r = await call('user sees own requests', 200, 'GET', '/join-requests/mine', KID);
  check('user sees why they were rejected', /or older/.test(r.body[0].rejectionReason));
});

scenario('New group requests', async ({ check, call, login }) => {
  const [SA, U1, U2] = [await login('admin@test.com'), await login('user1@com.au'), await login('user2@com.au')];

  await call('super admin cannot create groups directly (old route removed)', 404, 'POST', '/groups', SA, { name: 'x' });
  let r = await call('user requests a group', 200, 'POST', '/group-requests', U2, { name: 'Gamers', ageLimit: 16, colourTheme: 'Red' });
  const gamers = r.body.id;
  await call('duplicate pending name refused (any case)', 409, 'POST', '/group-requests', U1, { name: 'gamers' });
  await call('existing group name refused', 409, 'POST', '/group-requests', U1, { name: 'HELP' });
  await call('non-logo colour refused', 400, 'POST', '/group-requests', U1, { name: 'z', colourTheme: 'Green' });
  await call('super admin cannot request groups', 403, 'POST', '/group-requests', SA, { name: 'q' });
  r = await call('second request', 200, 'POST', '/group-requests', U1, { name: 'Books' });
  const books = r.body.id;

  await call("normal users can't list group requests", 403, 'GET', '/admin/group-requests', U1);
  r = await call('super admin lists group requests', 200, 'GET', '/admin/group-requests', SA);
  check('requests include the requester name', r.body.some((x) => x.requesterName === 'user2'));
  r = await call('super admin approves', 200, 'PUT', `/admin/group-requests/${gamers}`, SA, { approve: true });
  const newGroup = r.body.group.id;
  await call('super admin rejects with a reason', 200, 'PUT', `/admin/group-requests/${books}`, SA, { approve: false, reason: 'no' });
  await call("can't action twice", 409, 'PUT', `/admin/group-requests/${books}`, SA, { approve: true });
  await call('requester is admin of the new group', 200, 'PUT', `/groups/${newGroup}`, U2, { description: 'all games' });
  r = await call('requester sees own requests', 200, 'GET', '/group-requests/mine', U1);
  check('rejection reason is shown to the requester', r.body.some((x) => x.rejectionReason === 'no'));
  r = await call('groups list', 200, 'GET', '/groups', U1);
  check('new group is listed', r.body.some((g) => g.name === 'Gamers'));
});

scenario('Room requests and deleting rooms', async ({ check, call, login }) => {
  const [SA, U1, U2] = [await login('admin@test.com'), await login('user1@com.au'), await login('user2@com.au')];

  await call('admins cannot create rooms directly (old route removed)', 404, 'POST', '/groups/1/rooms', U1, { name: 'x' });
  let r = await call('member requests a room', 200, 'POST', '/groups/1/room-requests', U2, { name: 'memes' });
  const memes = r.body.id;
  await call('existing room name refused (any case)', 409, 'POST', '/groups/1/room-requests', U2, { name: 'START' });
  await call('duplicate pending name refused', 409, 'POST', '/groups/1/room-requests', U2, { name: 'MEMES' });
  await call("non-members can't request rooms", 403, 'POST', '/groups/1/room-requests', SA, { name: 'x' });
  const spam = (await call('another request', 200, 'POST', '/groups/1/room-requests', U2, { name: 'spam' })).body.id;
  const own = (await call("admin's own request", 200, 'POST', '/groups/1/room-requests', U1, { name: 'news' })).body.id;

  await call("members can't list room requests", 403, 'GET', '/groups/1/room-requests', U2);
  r = await call('admin lists room requests', 200, 'GET', '/groups/1/room-requests', U1);
  check('room requests include the requester name', r.body.some((x) => x.requesterName === 'user2'));
  await call('admins can approve their own request', 200, 'PUT', `/groups/1/room-requests/${own}`, U1, { approve: true });
  await call('rejecting needs a reason', 400, 'PUT', `/groups/1/room-requests/${spam}`, U1, { approve: false });
  await call('reject with a reason', 200, 'PUT', `/groups/1/room-requests/${spam}`, U1, { approve: false, reason: 'nah' });
  r = await call('approve creates the room', 200, 'PUT', `/groups/1/room-requests/${memes}`, U1, { approve: true });
  const room = r.body.room.id;
  await call("can't approve twice", 409, 'PUT', `/groups/1/room-requests/${memes}`, U1, { approve: true });
  r = await call('requester sees own requests', 200, 'GET', '/room-requests/mine', U2);
  check('rejection reason is shown to the requester', r.body.some((x) => x.rejectionReason === 'nah'));

  await call("members can't delete rooms", 403, 'DELETE', `/groups/1/rooms/${room}`, U2);
  await call('admin deletes the room', 200, 'DELETE', `/groups/1/rooms/${room}`, U1);
  await call('deleted room is gone', 404, 'DELETE', `/groups/1/rooms/${room}`, U1);
});

scenario('Promoting and demoting admins', async ({ check, call, login }) => {
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');

  await call("the only admin can't demote themselves", 409, 'PUT', '/groups/1/members/2/role', U1, { role: 'member' });
  await call('admin promotes a member', 200, 'PUT', '/groups/1/members/3/role', U1, { role: 'admin' });
  const r = await call('admin can demote themselves when another admin exists', 200, 'PUT', '/groups/1/members/2/role', U1, { role: 'member' });
  check('the role change is saved', r.body.members.some((m) => m.userId === 2 && m.role === 'member'));
  await call("an ex-admin can't promote themselves back", 403, 'PUT', '/groups/1/members/2/role', U1, { role: 'admin' });
  await call('non-members return 404', 404, 'PUT', '/groups/1/members/1/role', U2, { role: 'admin' });
});

scenario('Filing reports', async ({ call, login }) => {
  const SA = await login('admin@test.com');
  const U2 = await login('user2@com.au');
  await call('member reports another member', 200, 'POST', '/reports', U2, { groupId: 1, username: 'user1', reason: 'spam' });
  await call("can't report yourself", 400, 'POST', '/reports', U2, { groupId: 1, username: 'user2', reason: 'x' });
  await call("can't report someone outside the group", 404, 'POST', '/reports', U2, { groupId: 1, username: 'admin', reason: 'x' });
  await call("can't report in a group you're not in", 403, 'POST', '/reports', SA, { groupId: 1, username: 'user1', reason: 'x' });
});
