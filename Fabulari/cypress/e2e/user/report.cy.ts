// User: Submit Report page (U22)
describe('User: Submit Report page', () => {
  it('U22: reports a member', () => {
    cy.loginAs('user2@com.au', '/report');
    cy.get('#groupId').select('help');
    cy.get('#username').type('user1');
    cy.get('#reason').type('spamming the room');
    cy.contains('button', 'Submit').click();
    cy.contains('.alert-success', 'Report against user1 sent to the group admins.');
  });
});
