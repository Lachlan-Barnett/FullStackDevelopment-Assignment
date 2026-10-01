# Fabulari

Full Stack Development Assignment Git Repository

This is the git repository for the Full Stack Development Assignment chat application, "Fabulari", built with MongoDB, Express, Angular, Node.js and Socket.IO. The full documentation (requirements, data structures, Angular architecture, API, design and testing) is in [Phase2.md](Phase2.md). The Phase 1 documentation is in [Phase1.md](Phase1.md).


## Running the app

You need Node.js and MongoDB running on `mongodb://127.0.0.1:27017`.

```bash
# Install the dependencies (once)
cd Fabulari && npm install
cd server && npm install

# Reset the database to the demo data (optional, this deletes everything in "fabulari")
npm run seed

# Start the server (port 3000)
npm start

# In a second terminal, start the Angular app (port 4200)
cd Fabulari && npx ng serve
```

Then open http://localhost:4200. The demo accounts all use the password `123`:

| Email | Username | Role |
|---|---|---|
| admin@test.com | admin | Super admin |
| user1@com.au | user1 | Admin of the "help" group |
| user2@com.au | user2 | Member of the "help" group |


## Running the tests

```bash
cd Fabulari && npx ng test --watch=false   # Angular unit tests
cd Fabulari/server && npm test              # server API and socket tests (MongoDB must be running)

# End-to-end tests: stop the normal server first, as both use port 3000
cd Fabulari/server && npm run start:e2e     # e2e server with its own "fabulari_e2e" database
cd Fabulari && npx ng serve                 # the app
cd Fabulari && npx cypress run              # the Cypress tests
```
