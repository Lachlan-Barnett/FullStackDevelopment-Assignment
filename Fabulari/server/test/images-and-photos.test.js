const fs = require('fs');
const path = require('path');
const { scenario } = require('./helpers');

scenario('Image messages (PNG only, max 2MB)', async ({ check, call, login, sendFile, connect, ask, received, wait, tinyPng, baseUrl, uploadsDir }) => {
  const SA = await login('admin@test.com');
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const png = tinyPng();
  const upload = (roomId, token, buffer, options) => sendFile('POST', `/rooms/${roomId}/images`, token, buffer, options);
  const pngFiles = () => fs.readdirSync(uploadsDir).filter((f) => f.endsWith('.png'));

  let r = await upload(1, U2, png);
  check('a real PNG is accepted', r.status === 200 && /^\/uploads\/[0-9a-f-]{36}\.png$/.test(r.body.url), JSON.stringify(r));
  const url = r.body.url;
  r = await upload(1, U2, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]), { filename: 'sneaky.png' });
  check('a JPEG renamed to .png is rejected', r.status === 400 && r.body.message === 'Only PNG images are allowed');
  r = await upload(1, U2, Buffer.concat([png.subarray(0, 8), Buffer.alloc(2 * 1024 * 1024 + 1 - 8)]));
  check('files over 2MB are rejected (413)', r.status === 413 && /2MB/.test(r.body.message));
  r = await upload(1, U2, Buffer.concat([png.subarray(0, 8), Buffer.alloc(2 * 1024 * 1024 - 8)]));
  check('a file of exactly 2MB is accepted', r.status === 200);
  check("non-members can't upload", (await upload(1, SA, png)).status === 403);
  check('unknown room gives 404', (await upload(999, U2, png)).status === 404);
  check('uploading needs a login', (await upload(1, null, png)).status === 401);
  r = await upload(1, U2, null);
  check('a request with no file is rejected', r.status === 400 && r.body.message === 'No image was uploaded');
  check('the wrong form field is rejected', (await upload(1, U2, png, { field: 'wrongfield' })).status === 400);

  const served = await fetch(`${baseUrl}${url}`);
  check('uploaded images are served', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(png));
  check('served as image/png', served.headers.get('content-type') === 'image/png');
  check('served with a nosniff header', served.headers.get('x-content-type-options') === 'nosniff');

  const a = await connect(U1);
  const b = await connect(U2);
  await ask(a, 'room:join', { roomId: 1 });
  await ask(b, 'room:join', { roomId: 1 });
  r = await ask(b, 'message:send', { roomId: 1, type: 'image', content: url });
  check('an uploaded image can be sent', r.ok && r.message.type === 'image' && r.message.content === url);
  await wait(150);
  check('image messages reach the room', received(a, 'message:new').some((m) => m.type === 'image' && m.content === url));
  for (const bad of ['/uploads/00000000-0000-0000-0000-000000000000.png', 'https://evil.example/x.png', '/uploads/../server.js', '', 42]) {
    r = await ask(b, 'message:send', { roomId: 1, type: 'image', content: bad });
    check(`an image path that wasn't uploaded is refused (${JSON.stringify(bad)})`, !r.ok && r.message === 'Upload the image before sending it');
  }

  const before = pngFiles().length;
  for (let i = 0; i < 5; i++) await ask(b, 'message:send', { roomId: 1, type: 'text', content: `push ${i}` });
  check('when the 5-message cap drops an image, its file is deleted', !fs.existsSync(path.join(uploadsDir, path.basename(url))));
  check('exactly one file was removed', pngFiles().length === before - 1);
  check('the dropped image is no longer served', (await fetch(`${baseUrl}${url}`)).status === 404);

  const req = await call('request an image room', 200, 'POST', '/groups/1/room-requests', U2, { name: 'pics' });
  const room = (await call('approve it', 200, 'PUT', `/groups/1/room-requests/${req.body.id}`, U1, { approve: true })).body.room.id;
  await ask(b, 'room:join', { roomId: room });
  const up = await upload(room, U2, png);
  await ask(b, 'message:send', { roomId: room, type: 'image', content: up.body.url });
  check('the room image exists', fs.existsSync(path.join(uploadsDir, path.basename(up.body.url))));
  await call('delete the room', 200, 'DELETE', `/groups/1/rooms/${room}`, U1);
  check("deleting a room deletes its images", !fs.existsSync(path.join(uploadsDir, path.basename(up.body.url))));
});

scenario('Profile photos', async ({ check, api, call, login, sendFile, connect, ask, received, wait, tinyPng, baseUrl, uploadsDir, db }) => {
  const U1 = await login('user1@com.au');
  const U2 = await login('user2@com.au');
  const red = tinyPng([255, 0, 0]);
  const blue = tinyPng([0, 0, 255]);

  let r = await api('POST', '/auth', null, { email: 'user1@com.au', password: '123' });
  check('login includes profilePhoto (null at first)', r.body.profilePhoto === null);
  check("can't set someone else's photo", (await sendFile('PUT', '/users/3/photo', U1, red)).status === 403);
  check('setting a photo needs a login', (await sendFile('PUT', '/users/2/photo', null, red)).status === 401);
  r = await sendFile('PUT', '/users/2/photo', U1, Buffer.from('GIF89a not a png'), { filename: 'x.png' });
  check('non-PNG photos are rejected', r.status === 400 && r.body.message === 'Only PNG images are allowed');
  r = await sendFile('PUT', '/users/2/photo', U1, Buffer.concat([red.subarray(0, 8), Buffer.alloc(2 * 1024 * 1024)]));
  check('photos over 2MB are rejected', r.status === 413);
  check('a request with no file is rejected', (await sendFile('PUT', '/users/2/photo', U1, null)).status === 400);

  r = await sendFile('PUT', '/users/2/photo', U1, red);
  const first = r.body?.profilePhoto;
  check('uploading a photo works', r.status === 200 && /^\/uploads\/avatars\/2\.png\?v=\d+$/.test(first), JSON.stringify(r));
  check('the response has no password hash', !('passwordHash' in r.body));
  let served = await fetch(`${baseUrl}${first}`);
  check('the photo is served', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(red));
  r = await api('POST', '/auth', null, { email: 'user1@com.au', password: '123' });
  check('login returns the photo', r.body.profilePhoto === first);

  const a = await connect(U1);
  const b = await connect(U2);
  await ask(a, 'room:join', { roomId: 1 });
  await ask(b, 'room:join', { roomId: 1 });
  r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'photo test' });
  check("messages carry the sender's photo", r.message.senderPhoto === first);
  await wait(150);
  check('the photo reaches other members', received(b, 'message:new')[0]?.senderPhoto === first);
  r = await ask(b, 'message:send', { roomId: 1, type: 'text', content: 'no photo here' });
  check('users without a photo send null', r.message.senderPhoto === null);

  await wait(5);
  r = await sendFile('PUT', '/users/2/photo', U1, blue);
  const second = r.body.profilePhoto;
  check('changing the photo gives a new version', second !== first && second.startsWith('/uploads/avatars/2.png?v='));
  served = await fetch(`${baseUrl}${first}`);
  check('the old address still loads (now the new picture)', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(blue));
  const c = await connect(U2);
  r = await ask(c, 'room:join', { roomId: 1 });
  check('older messages show the current photo', r.history.find((m) => m.content === 'photo test')?.senderPhoto === second);
  const stored = await db.collection('messages').findOne({ content: 'photo test' });
  check("photos aren't stored on messages", stored && !('senderPhoto' in stored));

  await call('rename mid-session', 200, 'PUT', '/users/2', U1, { username: 'user1-renamed' });
  r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'after rename' });
  check('a username changed mid-session is used straight away', r.message.senderName === 'user1-renamed');

  r = await call('removing the photo works', 200, 'DELETE', '/users/2/photo', U1);
  check('removing sets the photo to null', r.body.profilePhoto === null);
  check('removing deletes the file', !fs.existsSync(path.join(uploadsDir, 'avatars', '2.png')));
  await call("can't remove someone else's photo", 403, 'DELETE', '/users/3/photo', U1);
  r = await ask(a, 'message:send', { roomId: 1, type: 'text', content: 'after removal' });
  check('messages after removal have no photo', r.message.senderPhoto === null);
});
