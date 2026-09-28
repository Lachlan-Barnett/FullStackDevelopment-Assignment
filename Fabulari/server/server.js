const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const initializeRoutes = require('./index');
const initializeSockets = require('./socket');

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
  app.use(express.json());
  // Express 5 leaves req.body undefined when a request has no body; treat that as an empty body.
  app.use((req, res, next) => {
    req.body ??= {};
    next();
  });

  initializeRoutes(app, db);
  initializeSockets(io);

  return server;
}

module.exports = createServer;
