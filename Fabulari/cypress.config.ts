import { defineConfig } from 'cypress';

export default defineConfig({
  // End-to-end tests run against the real app (ng serve on 4200) and server (npm start on 3000).
  // The "seed" task resets the demo database before each test using the server's own seed script.
  e2e: {
    baseUrl: 'http://localhost:4200',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    viewportWidth: 1400,
    viewportHeight: 900,
    video: false,
    setupNodeEvents(on) {
      on('task', {
        async seed() {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { connect } = require('./server/db');
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const seed = require('./server/seed');
          const { client, db } = await connect();
          await seed(db);
          await client.close();
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
