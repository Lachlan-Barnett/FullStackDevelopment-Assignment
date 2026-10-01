const { scenario } = require('./helpers');

scenario(
  'Socket connections, rooms, presence and messages',
  async ({ check, login, signup, connect, ask, received, wait }) => {
    const U1 = await login('user1@com.au'); // admin of group 1
    const U2 = await login('user2@com.au'); // member
    const OUT = await signup('out@t.com', 'outsider'); // logged in, not in group 1

    const noAuth = await connect(undefined);
    check(
      'connecting without a token is refused',
      noAuth.error === 'Not logged in',
      JSON.stringify(noAuth.error),
    );
    noAuth.close();
    const badAuth = await connect('junk');
    check('connecting with an invalid token is refused', badAuth.error === 'Not logged in');
    badAuth.close();

    const a = await connect(U1);
    const b = await connect(U2);
    const outsider = await connect(OUT);
    check('members can connect', a.connected && b.connected);

    let r = await ask(outsider, 'room:join', { roomId: 1 });
    check(
      "non-members can't join a room",
      !r.ok && r.message === 'Group members only',
      JSON.stringify(r),
    );
    r = await ask(a, 'room:join', { roomId: 999 });
    check("can't join a room that doesn't exist", !r.ok && r.message === 'Room not found');
    r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'early' });
    check("can't send before joining", !r.ok && /Join the room/.test(r.message));

    r = await ask(a, 'room:join', { roomId: 1 });
    check(
      'joining returns history and who is present',
      r.ok && Array.isArray(r.history) && r.present.map((p) => p.username).join() === 'user1',
    );
    r = await ask(b, 'room:join', { roomId: 1 });
    check(
      'second user sees both people present',
      r.ok &&
        r.present
          .map((p) => p.username)
          .sort()
          .join() === 'user1,user2',
    );
    await wait(150);
    check(
      'others are told when someone joins',
      received(a, 'presence:joined').some((e) => e.user.username === 'user2' && e.roomId === 1),
    );
    check("you aren't told about your own join", received(b, 'presence:joined').length === 0);
    check(
      'the "in this room" list is updated',
      received(a, 'presence:update').at(-1)?.users.length === 2,
    );

    const b2 = await connect(U2); // a second tab
    await ask(b2, 'room:join', { roomId: 1 });
    await wait(150);
    check(
      'a second tab is not announced as a new join',
      received(a, 'presence:joined').length === 1,
    );
    check(
      'a user with two tabs counts once',
      received(a, 'presence:update').at(-1)?.users.length === 2,
    );

    r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: '  hello room  ' });
    check(
      'sending a message works and trims it',
      r.ok &&
        r.message.content === 'hello room' &&
        r.message.senderName === 'user1' &&
        r.message.id > 0,
    );
    check('messages carry a server timestamp', !isNaN(Date.parse(r.message.timestamp)));
    await wait(150);
    check(
      'other members receive the message',
      received(b, 'message:new').some((m) => m.content === 'hello room'),
    );
    check(
      'every tab receives the message',
      received(b2, 'message:new').some((m) => m.content === 'hello room'),
    );
    check(
      'the sender receives their own message',
      received(a, 'message:new').some((m) => m.content === 'hello room'),
    );
    check(
      'people outside the room receive nothing',
      received(outsider, 'message:new').length === 0,
    );

    r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: '   ' });
    check('empty messages are refused', !r.ok && r.message === 'Message cannot be empty');
    r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'x'.repeat(2001) });
    check('messages over 2000 characters are refused', !r.ok && /at most/.test(r.message));
    r = await ask(a, 'message:send', { roomId: 1, type: 'image', content: 'x' });
    check(
      'image messages need an uploaded image',
      !r.ok && r.message === 'Upload the image before sending it',
    );
    r = await ask(a, 'message:send', { roomId: 1, type: 'video', content: 'x' });
    check('unknown message types are refused', !r.ok && r.message === 'Unsupported message type');

    b2.close();
    await wait(200);
    check(
      'closing one of two tabs is not announced as leaving',
      received(a, 'presence:left').length === 0,
    );
    r = await ask(b, 'room:leave', { roomId: 1 });
    await wait(200);
    check('leaving a room is acknowledged', r.ok);
    check(
      'others are told when someone leaves',
      received(a, 'presence:left').some((e) => e.user.username === 'user2'),
    );
    check(
      'the "in this room" list shrinks',
      received(a, 'presence:update').at(-1)?.users.length === 1,
    );
    r = await ask(b, 'message:send', { roomId: 1, type: 'text', content: 'after leave' });
    check("can't send after leaving", !r.ok);

    await ask(b, 'room:join', { roomId: 1 });
    await wait(100);
    const leftBefore = received(a, 'presence:left').length;
    b.close();
    await wait(200);
    check(
      'disconnecting is announced as leaving',
      received(a, 'presence:left').length === leftBefore + 1,
    );
  },
);

scenario(
  'Only the last 5 messages per room are kept',
  async ({ check, call, login, connect, ask, db }) => {
    const U1 = await login('user1@com.au');
    const U2 = await login('user2@com.au');
    const req = await call('request a second room', 200, 'POST', '/groups/1/room-requests', U2, {
      name: 'other',
    });
    const other = (
      await call('approve it', 200, 'PUT', `/groups/1/room-requests/${req.body.id}`, U1, {
        approve: true,
      })
    ).body.room.id;

    const a = await connect(U1);
    let r = await ask(a, 'room:join', { roomId: 1 });
    check('a new room has no history', r.ok && r.history.length === 0);
    for (let i = 1; i <= 7; i++)
      await ask(a, 'message:send', { roomId: 1, type: 'text', content: `msg ${i}` });
    await ask(a, 'room:join', { roomId: other });
    await ask(a, 'message:send', { roomId: other, type: 'text', content: 'in other room' });

    const b = await connect(U2);
    r = await ask(b, 'room:join', { roomId: 1 });
    check(
      'joining later gives the last 5 messages, oldest first',
      r.history.map((m) => m.content).join('|') === 'msg 3|msg 4|msg 5|msg 6|msg 7',
    );
    check(
      'history includes sender and time',
      r.history.every((m) => m.senderName === 'user1' && !isNaN(Date.parse(m.timestamp))),
    );
    check(
      'history has no Mongo _id',
      r.history.every((m) => !('_id' in m)),
    );
    check(
      'only 5 messages are stored for the room',
      (await db.collection('messages').countDocuments({ roomId: 1 })) === 5,
    );
    check(
      "other rooms' messages are unaffected",
      (await db.collection('messages').countDocuments({ roomId: other })) === 1,
    );

    await ask(b, 'room:leave', { roomId: 1 });
    r = await ask(b, 'room:join', { roomId: 1 });
    check('rejoining gives the same 5', r.history.length === 5 && r.history[4].content === 'msg 7');

    await call('delete the other room', 200, 'DELETE', `/groups/1/rooms/${other}`, U1);
    check(
      'deleting a room deletes its messages',
      (await db.collection('messages').countDocuments({ roomId: other })) === 0,
    );
    check(
      "other rooms' messages are kept",
      (await db.collection('messages').countDocuments({ roomId: 1 })) === 5,
    );
  },
);

scenario('The super admin does not chat', async ({ check, call, login, connect, ask, db }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  await call(
    "super admin can't ask to join groups",
    403,
    'POST',
    '/groups/1/join-requests',
    SA,
    {},
  );
  await call("super admin can't request groups", 403, 'POST', '/group-requests', SA, { name: 'x' });

  // Even if the super admin were put in a group directly, sockets still refuse chat.
  await db
    .collection('groups')
    .updateOne({ id: 1 }, { $push: { members: { userId: 1, role: 'member' } } });
  const s = await connect(SA);
  check('super admin can still connect', s.connected === true);
  let r = await ask(s, 'room:join', { roomId: 1 });
  check(
    "super admin can't join rooms, even when added to a group",
    !r.ok && r.message === 'The super admin cannot take part in chat',
  );
  r = await ask(s, 'message:send', { roomId: 1, type: 'text', content: 'hi' });
  check(
    "super admin can't send messages",
    !r.ok && r.message === 'The super admin cannot take part in chat',
  );

  const u = await connect(U1);
  check('normal users still join', (await ask(u, 'room:join', { roomId: 1 })).ok);
  check(
    'normal users still send',
    (await ask(u, 'message:send', { roomId: 1, type: 'text', content: 'hi' })).ok,
  );
});
