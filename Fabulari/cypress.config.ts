import { defineConfig } from 'cypress';

// Sockets opened by the typingAs task, closed again by closeSockets.
const openSockets: { close(): void }[] = [];

export default defineConfig({
  // End-to-end tests run against the real app (ng serve on 4200) and the e2e server
  // (npm run start:e2e in server/, on 3000), which uses its own "fabulari_e2e" database and uploads folder.
  // The "seed" task resets that database before each test, so the real "fabulari" data is never touched.
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    viewportWidth: 1400,
    viewportHeight: 900,
    video: false,
    setupNodeEvents(on) {
      on('task', {
        async seed() {
          // Must load before db and seed, which read the database name and uploads folder when loaded.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./server/e2e-env');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { connect } = require('./server/db');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const seed = require('./server/seed');
          const { client, db } = await connect();
          await seed(db);
          await client.close();
          return null;
        },

        // Cypress drives one browser, so a second person typing is simulated from Node: they log in,
        // join the room over their own socket and start typing. The socket stays open until closeSockets.
        async typingAs({
          email,
          roomId,
          password = '123',
        }: {
          email: string;
          roomId: number;
          password?: string;
        }) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { io } = require('socket.io-client');
          const res = await fetch('http://localhost:3000/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: email, password }),
          });
          const { valid, token } = await res.json();
          if (!valid) throw new Error(`typingAs: could not log in as ${email}`);
          const socket = io('http://localhost:3000', {
            auth: { token },
            transports: ['websocket'],
          });
          openSockets.push(socket);
          await new Promise((resolve, reject) => {
            socket.on('connect', resolve);
            socket.on('connect_error', reject);
          });
          const joined = await new Promise<{ ok: boolean; message?: string }>((resolve) =>
            socket.emit('room:join', { roomId }, resolve),
          );
          if (!joined.ok)
            throw new Error(`typingAs: ${email} could not join room ${roomId}: ${joined.message}`);
          socket.emit('typing', { roomId, typing: true });
          return null;
        },

        // Closes every socket opened by typingAs.
        closeSockets() {
          for (const socket of openSockets.splice(0)) socket.close();
          return null;
        },
      });
    },
  },
  component: {
    devServer: {
      framework: 'angular',
      bundler: 'webpack',
    },
    specPattern: '**/*.cy.ts',
  },
});
