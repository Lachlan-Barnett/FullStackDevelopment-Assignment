// User: Groups page (U15 to U18, U21, U28)
const helpRow = () => cy.contains('.group-row', 'help');

describe('User: Groups page', () => {
  it('U15: asks to join a group', () => {
    cy.apiSignup('adult@test.com', 'adult', '1995-05-05');
    cy.loginAs('adult@test.com', '/groups', 'p');
    helpRow().contains('button', 'Apply').click();
    helpRow().contains('button', 'Pending').should('be.disabled');
  });

  it('U16: under-age users are rejected automatically', () => {
    cy.apiSignup('kid@test.com', 'kid', '2016-01-01');
    cy.loginAs('kid@test.com', '/groups', 'p');
    helpRow().contains('button', 'Apply').click();
    helpRow().should('contain', 'Request rejected: You must be 13 or older to join this group');
    helpRow().contains('button', 'Apply again');
  });

  it('U28: searches the groups', () => {
    cy.apiLogin('user2@com.au').then(({ token }) =>
      cy.api('POST', '/group-requests', token, { name: 'Chess', description: 'board games' }),
    );
    cy.apiLogin('admin@test.com').then(({ token }) =>
      cy
        .api('GET', '/admin/group-requests', token)
        .then((res) =>
          cy.api('PUT', `/admin/group-requests/${res.body[0].id}`, token, { approve: true }),
        ),
    );
    cy.loginAs('user2@com.au', '/groups');
    cy.get('.group-row').should('have.length', 2);
    cy.get('#groupSearch').type('board');
    cy.get('.group-row').should('have.length', 1).and('contain', 'Chess');
    cy.contains('1 of 2 groups');
    cy.get('#groupSearch').clear().type('zzz');
    cy.contains('No groups match "zzz".');
  });

  it('U17: requests a new group', () => {
    cy.loginAs('user2@com.au', '/groups');
    cy.contains('button', 'Request a new group').click();
    cy.get('#newGroupName').type('Chess');
    cy.get('#newGroupDescription').type('Chess talk');
    cy.get('#newGroupAgeLimit').clear().type('12');
    cy.get('#newGroupColour').select('Red');
    cy.contains('form.request-form button', 'Send request').click();
    cy.contains('Request for "Chess" sent to the super admin.');
  });

  it('U18: a new group needs a name', () => {
    cy.loginAs('user2@com.au', '/groups');
    cy.contains('button', 'Request a new group').click();
    cy.contains('form.request-form button', 'Send request').click();
    cy.contains('Please give the group a name.');
  });

  it('U21: leaves a group', () => {
    cy.loginAs('user2@com.au', '/groups');
    helpRow().contains('button', 'Leave').click();
    helpRow().contains('button', 'Apply');
    cy.visit('/chat');
    cy.contains('Join a group to start chatting.');
  });
});
