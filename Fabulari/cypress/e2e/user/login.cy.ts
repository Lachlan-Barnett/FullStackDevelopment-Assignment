// User: Login page (U3 to U7)
describe('User: Login page', () => {
  it('U3: logs in and opens the chat page', () => {
    cy.visit('/');
    cy.get('#email').type('user2@com.au');
    cy.get('#password').type('123');
    cy.get('button[type=submit]').click();
    cy.location('pathname').should('eq', '/chat');
    cy.get('.room-title').should('contain', '# start');
    cy.waitForRoom().should('contain', 'user2');
  });

  it('U4: shows an error for a wrong password', () => {
    cy.visit('/');
    cy.get('#email').type('user2@com.au');
    cy.get('#password').type('wrong');
    cy.get('button[type=submit]').click();
    cy.contains('.alert', 'Invalid email or password');
    cy.location('pathname').should('eq', '/');
  });

  it('U5: pages need a login', () => {
    for (const page of ['/chat', '/groups', '/settings']) {
      cy.visit(page);
      cy.location('pathname').should('eq', '/');
    }
  });

  it('U6: logs out', () => {
    cy.loginAs('user2@com.au');
    cy.waitForRoom();
    cy.get('.logout').click();
    cy.location('pathname').should('eq', '/');
    cy.visit('/chat');
    cy.location('pathname').should('eq', '/');
  });

  it('U7: shows and hides the password', () => {
    cy.visit('/');
    cy.get('#password').type('secret').should('have.attr', 'type', 'password');
    cy.get('#show-password').check();
    cy.get('#password').should('have.attr', 'type', 'text');
  });
});
