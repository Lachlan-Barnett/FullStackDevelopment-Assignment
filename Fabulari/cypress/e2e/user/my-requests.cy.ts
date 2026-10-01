// User: My Requests page (U20)
describe('User: My Requests page', () => {
  it('U20: lists pending requests', () => {
    cy.apiLogin('user2@com.au').then(({ token }) => {
      cy.api('POST', '/group-requests', token, { name: 'Chess' });
      cy.api('POST', '/groups/1/room-requests', token, { name: 'memes' });
    });
    cy.loginAs('user2@com.au', '/requests');
    cy.contains('h2', 'Pending')
      .nextUntil('h2')
      .should('contain', 'Chess')
      .and('contain', 'memes in help');
  });
});
