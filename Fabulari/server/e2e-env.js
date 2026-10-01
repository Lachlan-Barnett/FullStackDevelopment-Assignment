// Points the server at its own database and uploads folder for the Cypress tests.
// The tests reset their data before every test, so they must never touch the real "fabulari" data.
// Loaded by `npm run start:e2e` (node -r ./e2e-env.js listen.js) and by the Cypress seed task.
const path = require('path');

process.env.DB_NAME = 'fabulari_e2e';
process.env.UPLOADS_DIR = path.join(__dirname, 'e2e-uploads');
