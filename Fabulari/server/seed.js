// Resets the database and fills it with demo data. Run with: npm run seed
// WARNING: this deletes everything in the Fabulari database first.
const bcrypt = require('bcryptjs');
const fs = require('fs');
const { connect, createIndexes, DB_NAME } = require('./db');
const { UPLOADS_DIR } = require('./uploads');

const DEMO_PASSWORD = '123';

async function seed(db) {
  await db.dropDatabase();
  await createIndexes(db);

  // Uploaded images belong to messages that no longer exist, so clear them too.
  await fs.promises.rm(UPLOADS_DIR, { recursive: true, force: true });
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [
    { id: 1, email: 'admin@test.com', username: 'admin', birthdate: '2000-01-01', role: 'superadmin' },
    { id: 2, email: 'user1@com.au', username: 'user1', birthdate: '2000-01-01', role: 'user' },
    { id: 3, email: 'user2@com.au', username: 'user2', birthdate: '2000-01-01', role: 'user' },
  ].map((u) => ({ ...u, passwordHash }));

  const groups = [
    {
      id: 1,
      name: 'help',
      description: 'anything',
      ageLimit: 13,
      colourTheme: 'Blue',
      members: [
        { userId: 2, role: 'admin' },
        { userId: 3, role: 'member' },
      ],
    },
  ];

  const rooms = [{ id: 1, groupId: 1, name: 'start', description: 'start', createdAt: new Date().toISOString() }];

  await db.collection('users').insertMany(users);
  await db.collection('groups').insertMany(groups);
  await db.collection('rooms').insertMany(rooms);

  // Start each id counter after the seeded ids so new records don't clash.
  await db.collection('counters').insertMany([
    { _id: 'users', seq: users.length },
    { _id: 'groups', seq: groups.length },
    { _id: 'rooms', seq: rooms.length },
  ]);
}

if (require.main === module) {
  (async () => {
    const { client, db } = await connect();
    await seed(db);
    await client.close();
    console.log(`Seeded "${DB_NAME}" (all demo passwords are "${DEMO_PASSWORD}")`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = seed;
