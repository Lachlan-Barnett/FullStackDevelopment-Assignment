const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'fabulari';

// Leave Mongo's internal _id out of everything sent to the client; each document has its own numeric id.
const NO_ID = { projection: { _id: 0 } };

// Case-insensitive matching, used for usernames and group and room names.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

// Connects to MongoDB, makes sure every index exists, and returns the client and database.
async function connect(url = MONGO_URL, dbName = DB_NAME) {
  const client = await MongoClient.connect(url);
  const db = client.db(dbName);
  await createIndexes(db);
  return { client, db };
}

// Unique indexes keep ids, emails and usernames unique; the others match the queries the server runs most,
// so lists stay fast as the number of users, groups, requests and log entries grows.
async function createIndexes(db) {
  await db.collection('users').createIndex({ id: 1 }, { unique: true });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  // Usernames are unique ignoring case, so either the email or the username can be used to log in.
  await db
    .collection('users')
    .createIndex({ username: 1 }, { unique: true, collation: CASE_INSENSITIVE });
  await db.collection('groups').createIndex({ id: 1 }, { unique: true });
  await db.collection('groups').createIndex({ name: 1 }, { collation: CASE_INSENSITIVE });
  await db.collection('groups').createIndex({ 'members.userId': 1 });
  await db.collection('rooms').createIndex({ id: 1 }, { unique: true });
  await db.collection('rooms').createIndex({ groupId: 1 });
  await db.collection('messages').createIndex({ id: 1 }, { unique: true });
  await db.collection('messages').createIndex({ roomId: 1, id: -1 });
  await db.collection('auditLog').createIndex({ type: 1, timestamp: -1 });
  await db.collection('auditLog').createIndex({ timestamp: -1 });
  // Emails of users removed from the system; they can never sign up again.
  await db
    .collection('bannedEmails')
    .createIndex({ email: 1 }, { unique: true, collation: CASE_INSENSITIVE });
  for (const name of [
    'reports',
    'joinRequests',
    'groupRequests',
    'roomRequests',
    'groupDeleteRequests',
    'bans',
    'systemBanRequests',
    'auditLog',
  ]) {
    await db.collection(name).createIndex({ id: 1 }, { unique: true });
  }
  // Pending lists for admins, and "my requests" lists for users.
  await db.collection('joinRequests').createIndex({ groupId: 1, status: 1 });
  await db.collection('joinRequests').createIndex({ userId: 1 });
  await db.collection('roomRequests').createIndex({ groupId: 1, status: 1 });
  await db.collection('roomRequests').createIndex({ requestedBy: 1 });
  await db.collection('groupRequests').createIndex({ status: 1 });
  await db.collection('groupRequests').createIndex({ requestedBy: 1 });
  await db.collection('reports').createIndex({ groupId: 1, status: 1 });
  await db.collection('groupDeleteRequests').createIndex({ groupId: 1, status: 1 });
  await db.collection('systemBanRequests').createIndex({ status: 1 });
  await db.collection('bans').createIndex({ scope: 1, groupId: 1 });
}

// Numeric ids (1, 2, 3...) per collection, kept in a "counters" collection.
// The Angular app and URLs use these ids, so they stay the same as in the JSON-file version.
async function nextId(db, collectionName) {
  const counter = await db
    .collection('counters')
    .findOneAndUpdate(
      { _id: collectionName },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
  return counter.seq;
}

module.exports = { connect, createIndexes, nextId, NO_ID, CASE_INSENSITIVE, MONGO_URL, DB_NAME };
