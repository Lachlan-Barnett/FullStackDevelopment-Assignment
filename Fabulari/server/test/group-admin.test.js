const { scenario } = require('./helpers');

// A birthdate that makes someone exactly `years` old today.
function bornYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

scenario(
  'Raising the age limit removes under-age members',
  async ({ check, call, login, signup, connect, ask, db }) => {
    const U1 = await login('user1@com.au'); // the group's admin, born 2000

    async function member(email, username, age) {
      const token = await signup(email, username, bornYearsAgo(age));
      const jr = await call(
        `${username} asks to join`,
        200,
        'POST',
        '/groups/1/join-requests',
        token,
        {},
      );
      await call(`${username} is let in`, 200, 'PUT', `/groups/1/join-requests/${jr.body.id}`, U1, {
        approve: true,
      });
      return token;
    }
    const teen15 = await member('a15@t.com', 'teen15', 15);
    await member('a17@t.com', 'teen17', 17);
    await member('a18@t.com', 'adult18', 18);
    const teen16 = await signup('a16@t.com', 'teen16', bornYearsAgo(16));
    const pending16 = (
      await call('a 16-year-old asks to join', 200, 'POST', '/groups/1/join-requests', teen16, {})
    ).body;

    const s15 = await connect(teen15);
    check(
      'the 15-year-old is chatting before the change',
      (await ask(s15, 'room:join', { roomId: 1 })).ok,
    );

    await call('a non-number age limit is refused', 400, 'PUT', '/groups/1', U1, {
      ageLimit: 'abc',
    });
    await call('a fractional age limit is refused', 400, 'PUT', '/groups/1', U1, {
      ageLimit: 12.5,
    });
    await call('an age limit over 120 is refused', 400, 'PUT', '/groups/1', U1, { ageLimit: 200 });

    let r = await call('the admin raises the limit to 18', 200, 'PUT', '/groups/1', U1, {
      ageLimit: 18,
    });
    check(
      'the response names the removed members',
      r.body.removedMembers
        .map((m) => m.username)
        .sort()
        .join() === 'teen15,teen17',
    );
    check(
      'the response contains no birthdates',
      !JSON.stringify(r.body.removedMembers).includes('birthdate'),
    );
    const group = await db.collection('groups').findOne({ id: 1 });
    const adult18 = (await db.collection('users').findOne({ username: 'adult18' })).id;
    check(
      'someone exactly 18 stays',
      group.members.some((m) => m.userId === adult18),
    );
    check(
      'the admin stays',
      group.members.some((m) => m.userId === 2),
    );
    check(
      'a pending request from someone too young is rejected',
      (await db.collection('joinRequests').findOne({ id: pending16.id })).status === 'rejected',
    );
    r = await ask(s15, 'message:send', { roomId: 1, type: 'text', content: 'still here?' });
    check("a removed member can't keep chatting", !r.ok);
    r = await call(
      'the rejected applicant checks their requests',
      200,
      'GET',
      '/join-requests/mine',
      teen16,
    );
    check('they see the age reason', /18 or older/.test(r.body[0].rejectionReason));

    r = await call('lowering the limit', 200, 'PUT', '/groups/1', U1, { ageLimit: 10 });
    check('lowering removes nobody', r.body.removedMembers.length === 0);
    r = await call('changing only the description', 200, 'PUT', '/groups/1', U1, {
      description: 'new text',
    });
    check(
      'other changes remove nobody',
      r.body.description === 'new text' && r.body.removedMembers.length === 0,
    );

    const before = await db.collection('groups').findOne({ id: 1 });
    r = await call(
      'a limit that would remove the only admin is refused',
      409,
      'PUT',
      '/groups/1',
      U1,
      { ageLimit: 30 },
    );
    check('the reason is given', /no admin/.test(r.body.message));
    const after = await db.collection('groups').findOne({ id: 1 });
    check(
      'nothing changes when refused',
      after.ageLimit === before.ageLimit && after.members.length === before.members.length,
    );

    const elder = await member('old@t.com', 'elder', 50);
    void elder;
    const elderId = (await db.collection('users').findOne({ username: 'elder' })).id;
    await call('elder is promoted', 200, 'PUT', `/groups/1/members/${elderId}/role`, U1, {
      role: 'admin',
    });
    r = await call('the same limit works once an older admin exists', 200, 'PUT', '/groups/1', U1, {
      ageLimit: 30,
    });
    check(
      'the younger admin is removed',
      r.body.removedMembers.some((m) => m.username === 'user1'),
    );
    check(
      'the older admin remains',
      (await db.collection('groups').findOne({ id: 1 })).members.some(
        (m) => m.userId === elderId && m.role === 'admin',
      ),
    );
  },
);

scenario('Audit log', async ({ check, call, api, login, signup }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');

  await call("group admins can't read the audit log", 403, 'GET', '/admin/audit-log', U1);
  let r = await call('super admin reads the log', 200, 'GET', '/admin/audit-log', SA);
  check(
    'the log is empty after seeding',
    r.body.entries.length === 0 && Array.isArray(r.body.types),
  );

  // One user's journey through the app.
  const carol = await signup('c@t.com', 'carol');
  const jr = await api('POST', '/groups/1/join-requests', carol, {});
  await api('PUT', `/groups/1/join-requests/${jr.body.id}`, U1, { approve: true });
  const rr = await api('POST', '/groups/1/room-requests', carol, { name: 'books' });
  await api('PUT', `/groups/1/room-requests/${rr.body.id}`, U1, { approve: true });
  const rep = await api('POST', '/reports', carol, {
    groupId: 1,
    username: 'user2',
    reason: 'spam',
  });
  await api('PUT', `/groups/1/reports/${rep.body.id}`, U1, { action: 'ban' });
  const gr = await api('POST', '/group-requests', carol, { name: 'Chess' });
  await api('PUT', `/admin/group-requests/${gr.body.id}`, SA, {
    approve: false,
    reason: 'not now',
  });
  await api('PUT', '/groups/1/members/4/role', U1, { role: 'admin' });
  await api('PUT', '/groups/1', U1, { description: 'updated' });

  r = await call('read the log after the journey', 200, 'GET', '/admin/audit-log', SA);
  const types = r.body.entries.map((e) => e.type);
  for (const t of [
    'USER_SIGNED_UP',
    'JOIN_REQUESTED',
    'JOIN_APPROVED',
    'ROOM_REQUESTED',
    'ROOM_CREATED',
    'REPORT_FILED',
    'USER_BANNED_FROM_GROUP',
    'GROUP_REQUESTED',
    'GROUP_REQUEST_REJECTED',
    'MEMBER_PROMOTED',
    'GROUP_UPDATED',
  ]) {
    check(`${t} is recorded`, types.includes(t), types.join(','));
    check(`${t} is offered in the type filter`, r.body.types.includes(t));
  }
  check('newest entries come first by default', r.body.entries[0].type === 'GROUP_UPDATED');
  const ban = r.body.entries.find((e) => e.type === 'USER_BANNED_FROM_GROUP');
  check(
    'entries name who did it and describe what happened',
    ban.actorName === 'user1' && /Banned user2 from "help"/.test(ban.details),
  );
  check(
    'entries record the target and time',
    ban.targetType === 'user' && ban.targetId === 3 && !isNaN(Date.parse(ban.timestamp)),
  );
  check('no Mongo _id is sent', !JSON.stringify(r.body).includes('"_id"'));

  r = await call('filter by type', 200, 'GET', '/admin/audit-log?type=JOIN_APPROVED', SA);
  check(
    'filtering returns only that type',
    r.body.entries.length === 1 && r.body.entries[0].type === 'JOIN_APPROVED',
  );
  r = await call('oldest first', 200, 'GET', '/admin/audit-log?order=oldest', SA);
  check('oldest-first starts with the signup', r.body.entries[0].type === 'USER_SIGNED_UP');
  const times = r.body.entries.map((e) => e.timestamp);
  check(
    'oldest-first is in ascending time order',
    times.every((t, i) => i === 0 || times[i - 1] <= t),
  );

  // Large logs are read a page at a time.
  const total = r.body.total;
  check(
    'the reply gives the total number of entries',
    total === r.body.entries.length && total > 4,
  );
  r = await call('first page of 2', 200, 'GET', '/admin/audit-log?order=oldest&limit=2', SA);
  check('a page holds at most the limit', r.body.entries.length === 2 && r.body.total === total);
  const second = await call(
    'second page of 2',
    200,
    'GET',
    '/admin/audit-log?order=oldest&limit=2&skip=2',
    SA,
  );
  check(
    'the next page carries on where the last one ended',
    second.body.entries[0].id === r.body.entries[1].id + 1,
  );

  await api('POST', '/groups/1/join-requests', await signup('k@t.com', 'kid', '2016-01-01'), {});
  r = await call(
    'filter auto-rejections',
    200,
    'GET',
    '/admin/audit-log?type=JOIN_AUTO_REJECTED',
    SA,
  );
  check(
    'automatic under-age rejections are recorded',
    r.body.entries.length === 1 && /rejected automatically/.test(r.body.entries[0].details),
  );

  // Names survive the account being deleted: user1 reports carol, carol (an admin) escalates, the super admin removes her.
  const rep2 = await api('POST', '/reports', U1, { groupId: 1, username: 'carol', reason: 'x' });
  const carolAdmin = await login('c@t.com', 'p');
  r = await call(
    'the report is escalated',
    200,
    'POST',
    `/groups/1/reports/${rep2.body.id}/escalate`,
    carolAdmin,
    {},
  );
  await call(
    'carol is removed from Fabulari',
    200,
    'PUT',
    `/admin/system-ban-requests/${r.body.id}`,
    SA,
    { approve: true },
  );
  r = await call('read signups', 200, 'GET', '/admin/audit-log?type=USER_SIGNED_UP', SA);
  check(
    "a deleted user's name stays on their old entries",
    r.body.entries.find((e) => e.details.startsWith('carol'))?.actorName === 'carol',
  );
  r = await call('read removals', 200, 'GET', '/admin/audit-log?type=USER_REMOVED', SA);
  check(
    'the removal is recorded with name and email',
    r.body.entries.length === 1 && /Removed carol \(c@t.com\)/.test(r.body.entries[0].details),
  );
});

scenario('Leaving a group', async ({ check, call, login, connect, ask, db }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au'); // the only admin
  const U2 = await login('user2@com.au');

  await call("non-members can't leave", 403, 'DELETE', '/groups/1/membership', SA);
  await call('an unknown group gives 404', 404, 'DELETE', '/groups/99/membership', U2);
  const r0 = await call("the only admin can't leave", 409, 'DELETE', '/groups/1/membership', U1);
  check('the reason is given', /only admin/.test(r0.body.message));

  const s2 = await connect(U2);
  await ask(s2, 'room:join', { roomId: 1 });
  await call('a member leaves', 200, 'DELETE', '/groups/1/membership', U2);
  check(
    'they are removed from the group',
    !(await db.collection('groups').findOne({ id: 1 })).members.some((m) => m.userId === 3),
  );
  check(
    "they can't keep chatting",
    !(await ask(s2, 'message:send', { roomId: 1, type: 'text', content: 'bye' })).ok,
  );
  await call("they can't see the rooms", 403, 'GET', '/groups/1/rooms', U2);
  const again = await call(
    'they can ask to rejoin (leaving is not a ban)',
    200,
    'POST',
    '/groups/1/join-requests',
    U2,
    {},
  );
  check('the rejoin request is pending', again.body.status === 'pending');
  const log = await call('check the audit log', 200, 'GET', '/admin/audit-log?type=GROUP_LEFT', SA);
  check(
    'leaving is recorded in the audit log',
    log.body.entries.length === 1 && log.body.entries[0].actorName === 'user2',
  );

  await call('user2 is let back in', 200, 'PUT', `/groups/1/join-requests/${again.body.id}`, U1, {
    approve: true,
  });
  await call('user2 is promoted', 200, 'PUT', '/groups/1/members/3/role', U1, { role: 'admin' });
  await call(
    'an admin can leave once another admin exists',
    200,
    'DELETE',
    '/groups/1/membership',
    U1,
  );
  check(
    'the group still has an admin',
    (await db.collection('groups').findOne({ id: 1 })).members.some((m) => m.role === 'admin'),
  );
});

scenario('Editing a room', async ({ check, call, login, connect, ask }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const rr = await call('request a second room', 200, 'POST', '/groups/1/room-requests', U2, {
    name: 'memes',
  });
  await call('approve it', 200, 'PUT', `/groups/1/room-requests/${rr.body.id}`, U1, {
    approve: true,
  });

  await call("members can't edit rooms", 403, 'PUT', '/groups/1/rooms/1', U2, { name: 'x' });
  await call('an unknown room gives 404', 404, 'PUT', '/groups/1/rooms/999', U1, { name: 'x' });
  await call('a blank name is refused', 400, 'PUT', '/groups/1/rooms/1', U1, { name: '   ' });
  await call('a non-text name is refused', 400, 'PUT', '/groups/1/rooms/1', U1, { name: 42 });
  await call("another room's name is refused (any case)", 409, 'PUT', '/groups/1/rooms/1', U1, {
    name: 'MEMES',
  });
  let r = await call(
    'a room can change the case of its own name',
    200,
    'PUT',
    '/groups/1/rooms/1',
    U1,
    { name: 'START' },
  );
  check('the new case is saved', r.body.name === 'START');
  r = await call('rename and new description', 200, 'PUT', '/groups/1/rooms/1', U1, {
    name: '  general  ',
    description: ' chat about anything ',
  });
  check(
    'both are saved, trimmed',
    r.body.name === 'general' && r.body.description === 'chat about anything',
  );
  r = await call('members list rooms', 200, 'GET', '/groups/1/rooms', U2);
  check(
    'members see the new name',
    r.body.some((x) => x.id === 1 && x.name === 'general'),
  );

  const s = await connect(U2);
  check('the renamed room can still be joined', (await ask(s, 'room:join', { roomId: 1 })).ok);
  check(
    'chat still works in the renamed room',
    (await ask(s, 'message:send', { roomId: 1, type: 'text', content: 'still works' })).ok,
  );
  r = await call('check the audit log', 200, 'GET', '/admin/audit-log?type=ROOM_UPDATED', SA);
  check(
    'edits are audited with the old name',
    r.body.entries.some((e) => /renamed from "START"/.test(e.details)),
  );
});

scenario('Renaming a group', async ({ check, call, login, db }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au'); // admin of "help"
  const U2 = await login('user2@com.au'); // member of "help"
  const chess = await call('user2 asks for a group', 200, 'POST', '/group-requests', U2, {
    name: 'chess',
  });
  await call(
    'the super admin creates it',
    200,
    'PUT',
    `/admin/group-requests/${chess.body.id}`,
    SA,
    { approve: true },
  );

  await call("members can't rename the group", 403, 'PUT', '/groups/1', U2, { name: 'mine' });
  await call(
    "a group can't be given another group's name (any case)",
    409,
    'PUT',
    '/groups/1',
    U1,
    { name: 'CHESS' },
  );
  await call('a blank name is refused', 400, 'PUT', '/groups/1', U1, { name: '  ' });
  await call('a name over 50 characters is refused', 400, 'PUT', '/groups/1', U1, {
    name: 'x'.repeat(51),
  });
  let r = await call('the admin renames the group', 200, 'PUT', '/groups/1', U1, {
    name: '  Help Desk ',
  });
  check('the new name is trimmed and returned', r.body.name === 'Help Desk');
  check(
    'the new name is saved',
    (await db.collection('groups').findOne({ id: 1 })).name === 'Help Desk',
  );
  r = await call(
    'changing only the capitals of its own name is allowed',
    200,
    'PUT',
    '/groups/1',
    U1,
    { name: 'help desk' },
  );
  check('the capitals change', r.body.name === 'help desk');
  const entry = await db
    .collection('auditLog')
    .findOne({ type: 'GROUP_UPDATED', details: /name: Help Desk/ });
  check('the rename is in the audit log', !!entry);
});
