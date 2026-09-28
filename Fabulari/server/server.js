const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const initializeRoutes = require('./index');
const initializeSockets = require('./socket');
const { UPLOADS_DIR, UPLOADS_URL } = require('./uploads');

// Builds the HTTP + Socket.IO server around an already-connected database.
// Kept separate from listen.js so tests can pass in a test database.
function createServer(db) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: 'http://localhost:4200',
      methods: ['GET', 'POST'],
    },
  });

  app.use(cors());
  // Uploaded images. nosniff stops browsers treating a file as anything other than the PNG it's served as.
  app.use(
    UPLOADS_URL,
    express.static(UPLOADS_DIR, { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }),
  );
  app.use(express.json());
  // Express 5 leaves req.body undefined when a request has no body; treat that as an empty body.
  app.use((req, res, next) => {
    req.body ??= {};
    next();
  });

  initializeRoutes(app, db);
  initializeSockets(io, db);

  return server;
}

module.exports = createServer;
