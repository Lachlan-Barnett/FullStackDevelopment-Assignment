const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'fabulari';

// Leave Mongo's internal _id out of everything sent to the client; each document has its own numeric id.
const NO_ID = { projection: { _id: 0 } };

// Case-insensitive matching, used for group and room names.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

async function connect(url = MONGO_URL, dbName = DB_NAME) {
  const client = await MongoClient.connect(url);
  const db = client.db(dbName);
  await createIndexes(db);
  return { client, db };
}

async function createIndexes(db) {
  await db.collection('users').createIndex({ id: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('groups').createIndex({ id: 1 }, { unique: true });
  await db.collection('rooms').createIndex({ id: 1 }, { unique: true });
  await db.collection('rooms').createIndex({ groupId: 1 });
  await db.collection('messages').createIndex({ id: 1 }, { unique: true });
  await db.collection('messages').createIndex({ roomId: 1, id: -1 });
  // Emails of users removed from the system; they can never sign up again.
  await db.collection('bannedEmails').createIndex({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
  for (const name of ['reports', 'joinRequests', 'groupRequests', 'roomRequests', 'groupDeleteRequests', 'bans', 'systemBanRequests']) {
    await db.collection(name).createIndex({ id: 1 }, { unique: true });
  }
}

// Numeric ids (1, 2, 3...) per collection, kept in a "counters" collection.
// The Angular app and URLs use these ids, so they stay the same as in the JSON-file version.
async function nextId(db, collectionName) {
  const counter = await db
    .collection('counters')
    .findOneAndUpdate({ _id: collectionName }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return counter.seq;
}

module.exports = { connect, createIndexes, nextId, NO_ID, CASE_INSENSITIVE, MONGO_URL, DB_NAME };
