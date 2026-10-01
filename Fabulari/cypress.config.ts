import { defineConfig } from 'cypress';

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
