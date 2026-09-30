// Shared set-up for the server test suite (run with `npm test`).
//
// Each test file starts the real Express + Socket.IO server on a free port, connected to a separate
// MongoDB database ("fabulari_test") and a separate uploads folder, so tests never touch demo data.
// The database is re-seeded before every scenario, so scenarios don't depend on each other.

const path = require('path');

// Must be set before the server modules are loaded, because they read these once.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'fabulari_test';
process.env.UPLOADS_DIR = path.join(__dirname, '..', 'test-uploads');

const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const zlib = require('zlib');
const { io } = require('socket.io-client');
const { connect: connectDb } = require('../db');
const createServer = require('../server');
const seed = require('../seed');
const { UPLOADS_DIR } = require('../uploads');

let client;
let db;
let server;
let baseUrl;

before(async () => {
  ({ client, db } = await connectDb());
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

// A real 1x1 PNG in the given colour, built in code so the tests need no image files.
function tinyPng(rgb = [255, 0, 0]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, ...rgb]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Everything a scenario needs, bound to this file's server.
function makeContext(sockets, check) {
  async function api(method, urlPath, token, body) {
    const res = await fetch(`${baseUrl}/api${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function sendFile(method, urlPath, token, buffer, { field = 'image', filename = 'pic.png', type = 'image/png' } = {}) {
    const form = new FormData();
    if (buffer) form.append(field, new Blob([buffer], { type }), filename);
    const res = await fetch(`${baseUrl}/api${urlPath}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  // Makes a request and checks its HTTP status in one step; returns the response for further checks.
  async function call(label, expectedStatus, method, urlPath, token, body) {
    const res = await api(method, urlPath, token, body);
    check(label, res.status === expectedStatus, `expected ${expectedStatus}, got ${res.status} ${JSON.stringify(res.body)}`);
    return res;
  }

  const login = async (email, password = '123') => (await api('POST', '/auth', null, { email, password })).body.token;
  const signup = async (email, username, birthdate = '1990-01-01', password = 'p') =>
    (await api('POST', '/signup', null, { email, username, birthdate, password })).body.token;

  // A logged-in socket. Every event it receives is kept in socket.events.
  const connect = (token) =>
    new Promise((resolve) => {
      const s = io(baseUrl, { auth: { token }, forceNew: true, transports: ['websocket'] });
      sockets.push(s);
      s.events = [];
      s.onAny((event, data) => s.events.push({ event, data }));
      s.on('connect', () => resolve(s));
      s.on('connect_error', (err) => resolve({ error: err.message, close: () => s.close() }));
    });
  const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const received = (socket, event) => socket.events.filter((e) => e.event === event).map((e) => e.data);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return { baseUrl, db, uploadsDir: UPLOADS_DIR, api, call, sendFile, login, signup, connect, ask, received, wait, tinyPng };
}

// Defines one scenario: a fresh seeded database, then a series of named checks.
// Each check(name, condition) is reported as its own test, so the output lists everything tested.
function scenario(name, fn) {
  test(name, async (t) => {
    await seed(db);
    const results = [];
    const sockets = [];
    const check = (label, condition, detail = '') => results.push({ label, ok: Boolean(condition), detail });
    try {
      await fn({ check, ...makeContext(sockets, check) });
    } finally {
      for (const s of sockets) s.close?.();
    }
    for (const r of results) {
      await t.test(r.label, () => assert.ok(r.ok, r.detail ? `${r.label}: ${r.detail}` : r.label));
    }
  });
}

module.exports = { scenario };
