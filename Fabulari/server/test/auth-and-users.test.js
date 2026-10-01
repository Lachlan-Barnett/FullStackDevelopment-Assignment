const { scenario } = require('./helpers');

scenario('Login, signup and password hashing', async ({ check, api, call, login, db }) => {
  let r = await call('correct password logs in', 200, 'POST', '/auth', null, {
    email: 'user1@com.au',
    password: '123',
  });
  check('login returns a token', typeof r.body.token === 'string' && r.body.valid === true);
  check('login never returns the password hash', !('passwordHash' in r.body));
  r = await call('wrong password is rejected', 200, 'POST', '/auth', null, {
    email: 'user1@com.au',
    password: 'x',
  });
  check('wrong password gives valid: false', r.body.valid === false);
  await call('missing fields are refused', 400, 'POST', '/auth', null, {});
  await call('numeric password is refused (400, not a crash)', 400, 'POST', '/auth', null, {
    email: 'user1@com.au',
    password: 123,
  });
  await call('object email is refused', 400, 'POST', '/auth', null, {
    email: { $gt: '' },
    password: '123',
  });

  r = await call('signup works', 200, 'POST', '/signup', null, {
    email: 't@t.com',
    username: 't',
    birthdate: '2001-01-01',
    password: 'pw1',
  });
  check('signup returns a token', typeof r.body.token === 'string');
  await call('duplicate email is refused', 409, 'POST', '/signup', null, {
    email: 't@t.com',
    username: 't2',
    birthdate: '2001-01-01',
    password: 'pw1',
  });
  await call('numeric signup password is refused', 400, 'POST', '/signup', null, {
    email: 'n@t.com',
    username: 'n',
    password: 5,
  });
  check('new user can log in', typeof (await login('t@t.com', 'pw1')) === 'string');

  const stored = await db.collection('users').findOne({ email: 't@t.com' });
  check(
    'password is stored as a bcrypt hash, not plain text',
    stored.passwordHash.startsWith('$2') && !('password' in stored),
  );

  const U1 = await login('user1@com.au');
  const SA = await login('admin@test.com');
  await call(
    "normal users can't list every account (profiles are private)",
    403,
    'GET',
    '/users',
    U1,
  );
  r = await call('the super admin can list every account', 200, 'GET', '/users', SA);
  check(
    'user list never includes password hashes',
    !JSON.stringify(r.body).includes('passwordHash'),
  );
  check('user list never includes Mongo _id', !JSON.stringify(r.body).includes('"_id"'));
});

scenario('Changing password', async ({ check, call, login }) => {
  const created = await call('sign up', 200, 'POST', '/signup', null, {
    email: 't@t.com',
    username: 't',
    birthdate: '2001-01-01',
    password: 'pw1',
  });
  const T = created.body.token;
  const id = created.body.id;

  await call('new password must be typed twice', 400, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'pw1',
    newPassword: 'a',
  });
  await call('mismatched new passwords are refused', 400, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'pw1',
    newPassword: 'a',
    confirmPassword: 'b',
  });
  await call('wrong current password is refused', 403, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'x',
    newPassword: 'a',
    confirmPassword: 'a',
  });
  await call('correct change is accepted', 200, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'pw1',
    newPassword: 'pw2',
    confirmPassword: 'pw2',
  });
  check('old password no longer works', (await login('t@t.com', 'pw1')) === undefined);
  check('new password works', typeof (await login('t@t.com', 'pw2')) === 'string');
});

scenario('Login tokens and access control', async ({ call, login }) => {
  const [SA, U1, U2] = [
    await login('admin@test.com'),
    await login('user1@com.au'),
    await login('user2@com.au'),
  ];
  await call('no token is refused', 401, 'GET', '/groups');
  await call('invalid token is refused', 401, 'GET', '/groups', 'junk');
  await call("can't edit another user's account", 403, 'PUT', '/users/2', U2, { username: 'hax' });
  await call('can edit own account', 200, 'PUT', '/users/3', U2, { username: 'user2' });
  await call("members can't edit the group", 403, 'PUT', '/groups/1', U2, { description: 'x' });
  await call('group admin can edit the group', 200, 'PUT', '/groups/1', U1, {
    description: 'anything',
  });
  await call("non-members can't list a group's rooms", 403, 'GET', '/groups/1/rooms', SA);
  await call('members can list rooms', 200, 'GET', '/groups/1/rooms', U2);
  await call('only logo colours are accepted', 400, 'PUT', '/groups/1', U1, {
    colourTheme: 'hotpink',
  });
  await call('a logo colour is accepted', 200, 'PUT', '/groups/1', U1, { colourTheme: 'Red' });
  await call('members can see the member list', 200, 'GET', '/groups/1/members', U2);
  await call("non-members can't see the member list", 403, 'GET', '/groups/1/members', SA);
});

scenario(
  'Email or username login, and unique usernames',
  async ({ check, api, call, login, db }) => {
    let r = await api('POST', '/auth', null, { login: 'user1', password: '123' });
    check(
      'login works with the username',
      r.body.valid === true && r.body.email === 'user1@com.au',
    );
    r = await api('POST', '/auth', null, { login: 'USER1', password: '123' });
    check('usernames ignore capitals when logging in', r.body.valid === true);
    r = await api('POST', '/auth', null, { login: 'User1@Com.au', password: '123' });
    check('emails ignore capitals when logging in', r.body.valid === true);
    r = await api('POST', '/auth', null, { login: 'user1', password: 'wrong' });
    check('a wrong password still fails with a username', r.body.valid === false);

    r = await call('sign up with capitals in the email', 200, 'POST', '/signup', null, {
      email: ' New@T.com ',
      username: 'newbie',
      birthdate: '2000-01-01',
      password: 'p',
    });
    check(
      'emails are stored trimmed and in lower case',
      !!(await db.collection('users').findOne({ email: 'new@t.com' })),
    );
    await call('the same email in other capitals is refused', 409, 'POST', '/signup', null, {
      email: 'NEW@t.COM',
      username: 'other',
      birthdate: '2000-01-01',
      password: 'p',
    });
    r = await call('a taken username is refused, ignoring capitals', 409, 'POST', '/signup', null, {
      email: 'x@t.com',
      username: 'User1',
      birthdate: '2000-01-01',
      password: 'p',
    });
    check('they are told the username is taken', /username is already taken/.test(r.body.message));
    await call('usernames cannot contain @', 400, 'POST', '/signup', null, {
      email: 'y@t.com',
      username: 'a@b',
      birthdate: '2000-01-01',
      password: 'p',
    });

    const U1 = await login('user1@com.au');
    await call("can't change to someone else's username", 409, 'PUT', '/users/2', U1, {
      username: 'USER2',
    });
    r = await call('can change the capitals of your own username', 200, 'PUT', '/users/2', U1, {
      username: 'User1',
    });
    check('the new username is returned', r.body.username === 'User1');
  },
);

scenario('Sign-up and profile validation', async ({ check, call, login }) => {
  const base = { email: 'v@t.com', username: 'valid', birthdate: '2000-01-01', password: 'p' };
  await call('a birthdate is required', 400, 'POST', '/signup', null, {
    ...base,
    birthdate: undefined,
  });
  await call('a birthdate in the future is refused', 400, 'POST', '/signup', null, {
    ...base,
    birthdate: '2999-01-01',
  });
  await call('a date that does not exist is refused', 400, 'POST', '/signup', null, {
    ...base,
    birthdate: '2001-02-30',
  });
  await call('a birthdate that is not a date is refused', 400, 'POST', '/signup', null, {
    ...base,
    birthdate: 'banana',
  });
  await call('an invalid email is refused', 400, 'POST', '/signup', null, {
    ...base,
    email: 'not-an-email',
  });
  await call('a blank username is refused', 400, 'POST', '/signup', null, {
    ...base,
    username: '   ',
  });
  await call('a username over 30 characters is refused', 400, 'POST', '/signup', null, {
    ...base,
    username: 'x'.repeat(31),
  });
  await call('valid details are accepted', 200, 'POST', '/signup', null, base);

  const U2 = await login('user2@com.au');
  await call("a username can't be changed to spaces", 400, 'PUT', '/users/3', U2, {
    username: '   ',
  });
  await call("a birthdate can't be changed to a non-date", 400, 'PUT', '/users/3', U2, {
    birthdate: 'banana',
  });
  await call('dark mode must be true or false', 400, 'PUT', '/users/3', U2, { darkMode: 'yes' });
  let r = await call('dark mode is saved on the account', 200, 'PUT', '/users/3', U2, {
    darkMode: true,
  });
  check('the saved setting is returned', r.body.darkMode === true);
  r = await call('log in again', 200, 'POST', '/auth', null, {
    email: 'user2@com.au',
    password: '123',
  });
  check('logging in brings back the dark mode setting', r.body.darkMode === true);

  await call('a group age limit over 120 is refused', 400, 'POST', '/group-requests', U2, {
    name: 'g1',
    ageLimit: 500,
  });
  await call('a fractional age limit is refused', 400, 'POST', '/group-requests', U2, {
    name: 'g2',
    ageLimit: 13.5,
  });
  await call('a negative age limit is refused', 400, 'POST', '/group-requests', U2, {
    name: 'g3',
    ageLimit: -1,
  });
  await call('a group name over 50 characters is refused', 400, 'POST', '/group-requests', U2, {
    name: 'x'.repeat(51),
  });
  await call('a description over 500 characters is refused', 400, 'POST', '/group-requests', U2, {
    name: 'g4',
    description: 'x'.repeat(501),
  });
  await call(
    'a numeric group name is refused (400, not a crash)',
    400,
    'POST',
    '/group-requests',
    U2,
    { name: 5 },
  );
  await call('a report reason over 500 characters is refused', 400, 'POST', '/reports', U2, {
    groupId: 1,
    username: 'user1',
    reason: 'x'.repeat(501),
  });
});

scenario(
  'A new birthdate under a group age limit removes you from the group',
  async ({ check, call, login, db }) => {
    const U1 = await login('user1@com.au'); // the only admin of "help" (age limit 13)
    const U2 = await login('user2@com.au'); // a member of "help"
    const tenYearsAgo = `${new Date().getFullYear() - 10}-01-01`;

    let r = await call(
      "the group's only admin can't become too young for it",
      409,
      'PUT',
      '/users/2',
      U1,
      { birthdate: tenYearsAgo },
    );
    check('they are told to promote someone first', /only admin of "help"/.test(r.body.message));
    check(
      'their birthdate is unchanged',
      (await db.collection('users').findOne({ id: 2 })).birthdate === '2000-01-01',
    );

    r = await call('a member can change to a younger birthdate', 200, 'PUT', '/users/3', U2, {
      birthdate: tenYearsAgo,
    });
    check(
      'the reply lists the groups they were removed from',
      r.body.removedFrom?.[0]?.name === 'help',
    );
    check(
      'they are no longer a member',
      !(await db.collection('groups').findOne({ id: 1 })).members.some((m) => m.userId === 3),
    );
    check(
      'the removal is in the audit log',
      !!(await db
        .collection('auditLog')
        .findOne({ type: 'MEMBERS_REMOVED_AGE_LIMIT', actorId: 3 })),
    );
  },
);
