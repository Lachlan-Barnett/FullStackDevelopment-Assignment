// Loaded before every end-to-end spec.
import './commands';

// Every test starts from the seed data, so tests never depend on each other.
beforeEach(() => {
  cy.seed();
});

// Confirmation pop-ups (leave group, ban, delete room...) are accepted unless a test says otherwise.
Cypress.on('window:confirm', () => true);

// Sockets a test opened to act as a second user (see the typingAs task) never outlive the test.
afterEach(() => {
  cy.task('closeSockets');
});
