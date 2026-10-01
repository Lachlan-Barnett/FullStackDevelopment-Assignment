const { scenario } = require('./helpers');

scenario('Login, signup and password hashing', async ({ check, api, call, login, db }) => {
  let r = await call('correct password logs in', 200, 'POST', '/auth', null, { email: 'user1@com.au', password: '123' });
  check('login returns a token', typeof r.body.token === 'string' && r.body.valid === true);
  check('login never returns the password hash', !('passwordHash' in r.body));
  r = await call('wrong password is rejected', 200, 'POST', '/auth', null, { email: 'user1@com.au', password: 'x' });
  check('wrong password gives valid: false', r.body.valid === false);
  await call('missing fields are refused', 400, 'POST', '/auth', null, {});
  await call('numeric password is refused (400, not a crash)', 400, 'POST', '/auth', null, { email: 'user1@com.au', password: 123 });
  await call('object email is refused', 400, 'POST', '/auth', null, { email: { $gt: '' }, password: '123' });

  r = await call('signup works', 200, 'POST', '/signup', null, { email: 't@t.com', username: 't', birthdate: '2001-01-01', password: 'pw1' });
  check('signup returns a token', typeof r.body.token === 'string');
  await call('duplicate email is refused', 409, 'POST', '/signup', null, { email: 't@t.com', username: 't', password: 'pw1' });
  await call('numeric signup password is refused', 400, 'POST', '/signup', null, { email: 'n@t.com', username: 'n', password: 5 });
  check('new user can log in', typeof (await login('t@t.com', 'pw1')) === 'string');

  const stored = await db.collection('users').findOne({ email: 't@t.com' });
  check('password is stored as a bcrypt hash, not plain text', stored.passwordHash.startsWith('$2') && !('password' in stored));

  const U1 = await login('user1@com.au');
  const SA = await login('admin@test.com');
  await call("normal users can't list every account (profiles are private)", 403, 'GET', '/users', U1);
  r = await call('the super admin can list every account', 200, 'GET', '/users', SA);
  check('user list never includes password hashes', !JSON.stringify(r.body).includes('passwordHash'));
  check('user list never includes Mongo _id', !JSON.stringify(r.body).includes('"_id"'));
});

scenario('Changing password', async ({ check, call, login }) => {
  const created = await call('sign up', 200, 'POST', '/signup', null, { email: 't@t.com', username: 't', birthdate: '2001-01-01', password: 'pw1' });
  const T = created.body.token;
  const id = created.body.id;

  await call('new password must be typed twice', 400, 'PUT', `/users/${id}/password`, T, { currentPassword: 'pw1', newPassword: 'a' });
  await call('mismatched new passwords are refused', 400, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'pw1', newPassword: 'a', confirmPassword: 'b',
  });
  await call('wrong current password is refused', 403, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'x', newPassword: 'a', confirmPassword: 'a',
  });
  await call('correct change is accepted', 200, 'PUT', `/users/${id}/password`, T, {
    currentPassword: 'pw1', newPassword: 'pw2', confirmPassword: 'pw2',
  });
  check('old password no longer works', (await login('t@t.com', 'pw1')) === undefined);
  check('new password works', typeof (await login('t@t.com', 'pw2')) === 'string');
});

scenario('Login tokens and access control', async ({ call, login }) => {
  const [SA, U1, U2] = [await login('admin@test.com'), await login('user1@com.au'), await login('user2@com.au')];
  await call('no token is refused', 401, 'GET', '/groups');
  await call('invalid token is refused', 401, 'GET', '/groups', 'junk');
  await call("can't edit another user's account", 403, 'PUT', '/users/2', U2, { username: 'hax' });
  await call('can edit own account', 200, 'PUT', '/users/3', U2, { username: 'user2' });
  await call("members can't edit the group", 403, 'PUT', '/groups/1', U2, { description: 'x' });
  await call('group admin can edit the group', 200, 'PUT', '/groups/1', U1, { description: 'anything' });
  await call("non-members can't list a group's rooms", 403, 'GET', '/groups/1/rooms', SA);
  await call('members can list rooms', 200, 'GET', '/groups/1/rooms', U2);
  await call('only logo colours are accepted', 400, 'PUT', '/groups/1', U1, { colourTheme: 'hotpink' });
  await call('a logo colour is accepted', 200, 'PUT', '/groups/1', U1, { colourTheme: 'Red' });
  await call("members can see the member list", 200, 'GET', '/groups/1/members', U2);
  await call("non-members can't see the member list", 403, 'GET', '/groups/1/members', SA);
});
