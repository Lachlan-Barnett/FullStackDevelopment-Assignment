// Shared commands for the Fabulari end-to-end tests.
//
// Set-up steps that aren't being tested (making extra users, join requests, reports...) go through the
// REST API with cy.request, so each test only drives the part of the UI it is actually testing.

const API = 'http://localhost:3000/api';

export interface LoggedIn {
  token: string;
  id: number;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Resets the demo database (and uploads) to the seed data. */
      seed(): Chainable<null>;
      /** Calls the REST API. Never fails on error statuses, so tests can check them. */
      api(
        method: string,
        path: string,
        token?: string | null,
        body?: object,
      ): Chainable<Response<any>>;
      /** Logs in through the API and returns the token and user. */
      apiLogin(email: string, password?: string): Chainable<LoggedIn>;
      /** Signs up a new user through the API and returns their token and id. */
      apiSignup(
        email: string,
        username: string,
        birthdate?: string,
        password?: string,
      ): Chainable<LoggedIn>;
      /** Signs up a new user and gets them into the "help" group (user1 approves the request). */
      addMemberToHelp(email: string, username: string, birthdate?: string): Chainable<LoggedIn>;
      /** Logs in without the login form (stores the session like the app does) and opens a page. */
      loginAs(email: string, path?: string, password?: string): Chainable<LoggedIn>;
      /** Waits until the chat page has joined its room (the "In this room" list is filled in). */
      waitForRoom(): Chainable<JQuery<HTMLElement>>;
      /** Types a chat message and sends it. */
      sendMessage(text: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}

Cypress.Commands.add('seed', () => cy.task('seed'));

Cypress.Commands.add('api', (method: string, path: string, token?: string | null, body?: object) =>
  cy.request({
    method,
    url: `${API}${path}`,
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    failOnStatusCode: false,
  }),
);

Cypress.Commands.add('apiLogin', (email: string, password = '123') =>
  cy.api('POST', '/auth', null, { email, password }).then((res) => {
    expect(res.body.valid, `login as ${email}`).to.eq(true);
    return { token: res.body.token, id: res.body.id, username: res.body.username };
  }),
);

Cypress.Commands.add(
  'apiSignup',
  (email: string, username: string, birthdate = '1990-01-01', password = 'p') =>
    cy.api('POST', '/signup', null, { email, username, birthdate, password }).then((res) => {
      expect(res.status, `sign up ${email}`).to.eq(200);
      return { token: res.body.token, id: res.body.id, username: res.body.username };
    }),
);

Cypress.Commands.add(
  'addMemberToHelp',
  (email: string, username: string, birthdate = '1990-01-01') =>
    cy.apiSignup(email, username, birthdate).then((member) =>
      cy.api('POST', '/groups/1/join-requests', member.token, {}).then((join) =>
        cy.apiLogin('user1@com.au').then((admin) =>
          cy
            .api('PUT', `/groups/1/join-requests/${join.body.id}`, admin.token, {
              approve: true,
            })
            .then(() => member),
        ),
      ),
    ),
);

Cypress.Commands.add('loginAs', (email: string, path = '/chat', password = '123') =>
  cy.api('POST', '/auth', null, { email, password }).then((res) => {
    const { valid, message, token, ...user } = res.body;
    cy.visit(path, {
      onBeforeLoad(win) {
        win.localStorage.setItem('currentUser', JSON.stringify(user));
        win.localStorage.setItem('authToken', token);
      },
    });
    return cy.wrap({ token, id: user.id, username: user.username } as LoggedIn);
  }),
);

Cypress.Commands.add('waitForRoom', () =>
  cy.get('.present-users', { timeout: 15000 }).should(($el) => {
    const text = $el.text().trim();
    expect(text).not.to.eq('');
    expect(text).not.to.eq('—');
  }),
);

Cypress.Commands.add('sendMessage', (text: string) => {
  cy.get('input[name=draft]').type(text);
  return cy.get('button[aria-label="Send message"]').click();
});

export {};
