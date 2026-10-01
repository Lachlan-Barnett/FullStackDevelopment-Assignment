// User: Signup page (U1, U2)
describe('User: Signup page', () => {
  it('U1: signs up a new account', () => {
    cy.visit('/signup');
    cy.get('#email').type('newuser@test.com');
    cy.get('#username').type('newuser');
    cy.get('#dob').type('1995-05-05');
    cy.get('#password').type('pass123');
    cy.get('button[type=submit]').click();
    cy.location('pathname').should('eq', '/chat');
    cy.contains('Join a group to start chatting.');
  });

  it('U2: refuses an email that is already registered', () => {
    cy.visit('/signup');
    cy.get('#email').type('user1@com.au');
    cy.get('#username').type('copycat');
    cy.get('#dob').type('1995-05-05');
    cy.get('#password').type('pass123');
    cy.get('button[type=submit]').click();
    cy.contains('.alert', 'Email already registered');
    cy.location('pathname').should('eq', '/signup');
  });
});
