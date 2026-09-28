const createServer = require('./server');
const { connect, DB_NAME } = require('./db');

const PORT = process.env.PORT || 3000;

(async () => {
  const { db } = await connect();
  console.log(`Connected to MongoDB database "${DB_NAME}"`);

  createServer(db).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
})().catch((err) => {
  console.error('Could not start the server. Is MongoDB running?', err.message);
  process.exit(1);
});
