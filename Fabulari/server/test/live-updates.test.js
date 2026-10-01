const { scenario } = require('./helpers');

// Signs up a user who asks to join "help" (group 1). Returns their token and the join request id.
async function applicant({ call, signup }, email, username) {
  const token = await signup(email, username);
  const jr = await call(
    `${username} asks to join`,
    200,
    'POST',
    '/groups/1/join-requests',
    token,
    {},
  );
  return { token, requestId: jr.body.id };
}

// The pop-up messages and page refreshes a socket has received so far.
const notes = (received, socket) => received(socket, 'notification').map((n) => n.message);
const scopes = (received, socket) => received(socket, 'refresh').map((r) => r.scope);

scenario('Live notifications and page refreshes', async (ctx) => {
  const { check, call, login, connect, received, wait } = ctx;
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au'); // admin of "help"
  const U2 = await login('user2@com.au'); // member of "help"
  const [saSocket, u1Socket, u2Socket] = [await connect(SA), await connect(U1), await connect(U2)];

  const carol = await applicant(ctx, 'c@t.com', 'carol');
  const carolSocket = await connect(carol.token);
  await wait(150);
  check(
    'the group admin is told about a new join request',
    notes(received, u1Socket).some((m) => m === 'carol asked to join "help"'),
  );
  check(
    "the admin's dashboard is told to reload",
    received(u1Socket, 'refresh').some((r) => r.scope === 'group-admin' && r.groupId === 1),
  );
  check(
    "the super admin's dashboard reloads after every audited action",
    scopes(received, saSocket).includes('super-admin'),
  );
  check('plain members are not told about join requests', notes(received, u2Socket).length === 0);

  await call('user1 lets carol in', 200, 'PUT', `/groups/1/join-requests/${carol.requestId}`, U1, {
    approve: true,
  });
  await wait(150);
  check(
    'carol is told she has joined',
    notes(received, carolSocket).some((m) => m.startsWith('You have joined "help"')),
  );
  check(
    "carol's group list and requests reload",
    ['groups', 'requests'].every((s) => scopes(received, carolSocket).includes(s)),
  );
  check(
    "other members' group lists reload (new member)",
    scopes(received, u2Socket).includes('groups'),
  );

  const room = await call('user2 asks for a room', 200, 'POST', '/groups/1/room-requests', U2, {
    name: 'memes',
  });
  await wait(150);
  check(
    'the admin is told about the room request',
    notes(received, u1Socket).some((m) => m.includes('asked for a new room "memes"')),
  );
  await call('user1 approves the room', 200, 'PUT', `/groups/1/room-requests/${room.body.id}`, U1, {
    approve: true,
  });
  await wait(150);
  check(
    'the requester is told the room was approved',
    notes(received, u2Socket).some((m) => m === 'Your room "memes" in "help" was approved'),
  );
  check(
    "every member's room list reloads",
    received(carolSocket, 'refresh').some((r) => r.scope === 'rooms' && r.groupId === 1),
  );

  const chess = await call(
    'carol asks for a new group',
    200,
    'POST',
    '/group-requests',
    carol.token,
    { name: 'chess' },
  );
  await wait(150);
  check(
    'the super admin is told about the group request',
    notes(received, saSocket).some((m) => m === 'carol asked for a new group "chess"'),
  );
  await call(
    'the super admin approves it',
    200,
    'PUT',
    `/admin/group-requests/${chess.body.id}`,
    SA,
    { approve: true },
  );
  await wait(150);
  check(
    'carol is told her group was approved',
    notes(received, carolSocket).some((m) => m.startsWith('Your group "chess" was approved')),
  );

  await call('user1 promotes user2', 200, 'PUT', '/groups/1/members/3/role', U1, { role: 'admin' });
  await wait(150);
  check(
    'user2 is told they are now an admin',
    notes(received, u2Socket).includes('You are now an admin of "help"'),
  );
  check(
    'user1 gets no pop-up about their own action',
    !notes(received, u1Socket).some((m) => m.includes('now an admin')),
  );

  await call('user1 renames the group', 200, 'PUT', '/groups/1', U1, { name: 'helpdesk' });
  await wait(150);
  check(
    'members reload their groups after a rename',
    received(carolSocket, 'refresh').filter((r) => r.scope === 'groups').length >= 2,
  );
});

scenario('Removed members are taken out of live rooms', async (ctx) => {
  const { check, call, login, connect, ask, received, wait } = ctx;
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const carol = await applicant(ctx, 'c@t.com', 'carol');
  await call('carol is let in', 200, 'PUT', `/groups/1/join-requests/${carol.requestId}`, U1, {
    approve: true,
  });

  const a = await connect(U1);
  const c = await connect(carol.token);
  await ask(a, 'room:join', { roomId: 1 });
  await ask(c, 'room:join', { roomId: 1 });

  // A ban takes carol out of the room at once: she stops receiving messages and others see her leave.
  const report = await call('user2 reports carol', 200, 'POST', '/reports', U2, {
    groupId: 1,
    username: 'carol',
    reason: 'spam',
  });
  await call('user1 bans carol', 200, 'PUT', `/groups/1/reports/${report.body.id}`, U1, {
    action: 'ban',
  });
  await wait(150);
  check(
    'carol is told she was banned',
    notes(received, c).includes('You have been banned from "help"'),
  );
  check(
    'the others see carol leave the room',
    received(a, 'presence:left').some((e) => e.user.username === 'carol'),
  );
  await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'after the ban' });
  await wait(150);
  check(
    "carol no longer receives the room's messages",
    !received(c, 'message:new').some((m) => m.content === 'after the ban'),
  );
  const r = await ask(c, 'message:send', { roomId: 1, type: 'text', content: 'still here?' });
  check('carol can no longer send to the room', !r.ok);

  // Deleting a room empties it straight away.
  const extra = await call('user2 asks for a room', 200, 'POST', '/groups/1/room-requests', U2, {
    name: 'old',
  });
  const roomId = (
    await call('user1 approves it', 200, 'PUT', `/groups/1/room-requests/${extra.body.id}`, U1, {
      approve: true,
    })
  ).body.room.id;
  const b = await connect(U2);
  await ask(b, 'room:join', { roomId });
  await call('user1 deletes the room', 200, 'DELETE', `/groups/1/rooms/${roomId}`, U1);
  await wait(150);
  check(
    'members are told to reload the room list',
    received(b, 'refresh').some((e) => e.scope === 'rooms' && e.groupId === 1),
  );
  const sent = await ask(b, 'message:send', { roomId, type: 'text', content: 'hello?' });
  check('nobody can send to the deleted room', !sent.ok);

  // A younger birthdate takes user2 out of "help" (age limit 13) and out of its rooms.
  await ask(b, 'room:join', { roomId: 1 });
  await call('user2 changes to a younger birthdate', 200, 'PUT', '/users/3', U2, {
    birthdate: `${new Date().getFullYear() - 10}-01-01`,
  });
  await wait(150);
  check(
    'user2 leaves the room after the birthdate change',
    received(a, 'presence:left').some((e) => e.user.username === 'user2'),
  );

  // Removing an account from Fabulari tells its open tabs and disconnects them.
  const dave = await applicant(ctx, 'd@t.com', 'dave');
  await call('dave is let in', 200, 'PUT', `/groups/1/join-requests/${dave.requestId}`, U1, {
    approve: true,
  });
  const erin = await applicant(ctx, 'e@t.com', 'erin');
  await call('erin is let in', 200, 'PUT', `/groups/1/join-requests/${erin.requestId}`, U1, {
    approve: true,
  });
  const d = await connect(dave.token);
  const rep = await call('erin reports dave', 200, 'POST', '/reports', erin.token, {
    groupId: 1,
    username: 'dave',
    reason: 'abuse',
  });
  const removal = await call(
    'user1 asks the super admin to remove dave',
    200,
    'POST',
    `/groups/1/reports/${rep.body.id}/escalate`,
    U1,
    {},
  );
  await call(
    'the super admin removes dave',
    200,
    'PUT',
    `/admin/system-ban-requests/${removal.body.id}`,
    SA,
    { approve: true },
  );
  await wait(200);
  check(
    "dave's open tab is told the account was removed",
    received(d, 'account:removed').length === 1,
  );
  check("dave's open tab is disconnected", d.disconnected === true);
});

scenario('Typing indicator', async ({ check, login, signup, connect, ask, received, wait }) => {
  const a = await connect(await login('user1@com.au'));
  const b = await connect(await login('user2@com.au'));
  const outsider = await connect(await signup('o@t.com', 'outsider'));
  await ask(a, 'room:join', { roomId: 1 });
  await ask(b, 'room:join', { roomId: 1 });

  a.emit('typing', { roomId: 1, typing: true });
  await wait(150);
  const seen = received(b, 'typing');
  check(
    'others in the room see who is typing',
    seen.some((e) => e.roomId === 1 && e.user.username === 'user1' && e.typing === true),
  );
  check('you are not told about your own typing', received(a, 'typing').length === 0);

  a.emit('typing', { roomId: 1, typing: false });
  await wait(150);
  check('stopping typing is passed on too', received(b, 'typing').at(-1)?.typing === false);

  outsider.emit('typing', { roomId: 1, typing: true });
  await wait(150);
  check(
    "people who haven't joined the room can't send typing events",
    !received(b, 'typing').some((e) => e.user.username === 'outsider'),
  );

  a.emit('typing', { roomId: 1, typing: true });
  await wait(100);
  await ask(a, 'room:leave', { roomId: 1 });
  await wait(150);
  check(
    'leaving the room clears the typing indicator',
    received(b, 'typing').at(-1)?.typing === false,
  );
});
