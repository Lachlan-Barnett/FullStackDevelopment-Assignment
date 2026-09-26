const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'data.json');

function loadDb() {
  const db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) : {};
  // Make sure every collection exists, even in data files saved before it was added.
  for (const key of ['users', 'groups', 'rooms', 'reports', 'joinRequests', 'groupRequests']) {
    db[key] ??= [];
  }
  return db;
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { loadDb, saveDb };