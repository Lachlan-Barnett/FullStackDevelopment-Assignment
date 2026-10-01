// Group admin: Chat page (A1)
describe('Group admin: Chat page', () => {
  it('A1: only admins see Manage Group', () => {
    cy.loginAs('user2@com.au');
    cy.waitForRoom();
    cy.get('.admin-link').should('not.exist');

    cy.loginAs('user1@com.au');
    cy.waitForRoom();
    cy.get('.admin-link').should('contain', 'Manage Group').click();
    cy.location('pathname').should('eq', '/admin/group/1');
  });
});
