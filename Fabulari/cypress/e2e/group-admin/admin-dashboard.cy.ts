// Group admin: Group Admin Dashboard (A2 to A13)

// A dashboard panel, found by its title.
const panel = (title: string) => cy.contains('.panel-title', title).parents('.panel').first();

// A birthdate that makes someone exactly `years` old today.
const bornYearsAgo = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

// user2 asks for a room and returns the request id.
const requestRoom = (name: string) =>
  cy.apiLogin('user2@com.au').then(({ token }) =>
    cy.api('POST', '/groups/1/room-requests', token, { name }).then((res) => res.body.id as number),
  );

describe('Group admin: Group Admin Dashboard', () => {
  it('A2: members cannot open the admin page', () => {
    cy.loginAs('user2@com.au', '/admin/group/1');
    cy.location('pathname').should('eq', '/chat');
  });

  it('A3: approves a join request', () => {
    cy.apiSignup('newbie@test.com', 'newbie').then(({ token }) => cy.api('POST', '/groups/1/join-requests', token, {}));
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Join Requests').contains('.request-card', 'newbie').contains('button', 'Approve').click();
    panel('Join Requests').should('contain', 'No pending join requests.');
    panel('Members').should('contain', 'newbie');

    cy.loginAs('newbie@test.com', '/chat', 'p');
    cy.waitForRoom();
    cy.sendMessage('thanks for letting me in');
    cy.contains('.message-text', 'thanks for letting me in');
  });

  it('A4: rejects a join request with a reason', () => {
    cy.apiSignup('newbie@test.com', 'newbie').then(({ token }) => cy.api('POST', '/groups/1/join-requests', token, {}));
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Join Requests').contains('.request-card', 'newbie').within(() => {
      cy.get('input').type('group is full');
      cy.contains('button', 'Reject').click();
    });
    panel('Join Requests').should('contain', 'No pending join requests.');

    cy.loginAs('newbie@test.com', '/groups', 'p');
    cy.contains('.group-row', 'help').should('contain', 'Request rejected: group is full');
  });

  it('A5: approves a room request', () => {
    requestRoom('memes');
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Channel Requests').contains('.request-card', 'memes').contains('button', 'Approve').click();
    panel('Channels').should('contain', 'memes');
    cy.visit('/chat');
    cy.contains('.rooms-col .list-btn', 'memes');
  });

  it('A6: rejecting a room request needs a reason', () => {
    requestRoom('memes');
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Channel Requests').contains('.request-card', 'memes').contains('button', 'Reject').click();
    cy.contains('.error-text', 'Enter a reason before rejecting "memes".');

    panel('Channel Requests').contains('.request-card', 'memes').within(() => {
      cy.get('input').type('not needed');
      cy.contains('button', 'Reject').click();
    });
    panel('Channel Requests').should('contain', 'No pending channel requests.');

    cy.loginAs('user2@com.au', '/requests');
    cy.contains('h2', 'Rejected').nextUntil('h2').should('contain', 'memes').and('contain', 'Reason: not needed');
  });

  it('A7: edits the group details', () => {
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Group Details').within(() => {
      cy.get('textarea[name=editDescription]').clear().type('A new description');
      cy.get('select[name=editColourTheme]').select('Red');
      cy.contains('button', 'Save Changes').click();
      cy.contains('[role=status]', 'Saved.');
    });

    cy.visit('/chat');
    cy.waitForRoom();
    cy.get('.messages-list').should('have.css', 'background-color', 'rgba(204, 32, 39, 0.15)');
    cy.get('.description-toggle').click();
    cy.contains('.info-box', 'A new description');
  });

  it('A8: raising the age limit removes under-age members', () => {
    cy.addMemberToHelp('teen@test.com', 'teen', bornYearsAgo(15));
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Members').should('contain', 'teen');
    panel('Group Details').within(() => {
      cy.get('input[name=editAgeLimit]').clear().type('18');
      cy.contains('button', 'Save Changes').click();
      cy.contains('[role=status]', 'Removed 1 member(s) under the new age limit: teen.');
    });
    panel('Members').should('not.contain', 'teen');
  });

  it('A9: promotes and demotes a member', () => {
    cy.loginAs('user1@com.au', '/admin/group/1');
    cy.contains('.member-row', 'user1').find('button').should('be.disabled'); // the only admin

    cy.contains('.member-row', 'user2').contains('button', 'Promote').click();
    cy.contains('.member-row', 'user2').find('.role-badge').should('have.text', 'admin');
    cy.contains('.member-row', 'user1').find('button').should('not.be.disabled');

    cy.contains('.member-row', 'user2').contains('button', 'Demote').click();
    cy.contains('.member-row', 'user2').find('.role-badge').should('have.text', 'member');
    cy.contains('.member-row', 'user1').find('button').should('be.disabled');
  });

  it('A10: bans a member from a report', () => {
    cy.addMemberToHelp('carol@test.com', 'carol').then(({ token }) =>
      cy.api('POST', '/reports', token, { groupId: 1, username: 'user2', reason: 'spamming' }),
    );
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Reports').contains('.request-card', 'user2').contains('button', 'Ban from group').click();
    panel('Reports').should('contain', 'No reports to review.');
    panel('Members').should('not.contain', 'user2');
    panel('Banned Members').should('contain', 'user2').and('contain', 'spamming');

    cy.loginAs('user2@com.au', '/groups');
    cy.contains('.group-row', 'help').within(() => {
      cy.contains('Banned');
      cy.contains('button', 'Apply').should('not.exist');
    });
  });

  it('A11: edits a room', () => {
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Channels').find('button[aria-label="Edit start"]').click();
    cy.get('#room-name-1').clear().type('general');
    panel('Channels').contains('button', 'Save').click();
    // The seeded room's description is also "start", so check the room's name via its Edit button.
    panel('Channels').find('button[aria-label="Edit general"]').should('exist');
    panel('Channels').find('button[aria-label="Edit start"]').should('not.exist');
    cy.visit('/chat');
    cy.contains('.rooms-col .list-btn', 'general');
  });

  it('A12: deletes a room', () => {
    requestRoom('old-room').then((id) =>
      cy.apiLogin('user1@com.au').then(({ token }) =>
        cy.api('PUT', `/groups/1/room-requests/${id}`, token, { approve: true }),
      ),
    );
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Channels').find('button[aria-label="Delete old-room"]').click();
    panel('Channels').should('not.contain', 'old-room');
    cy.visit('/chat');
    cy.get('.rooms-col').should('not.contain', 'old-room');
  });

  it('A13: asks the super admin to delete the group', () => {
    cy.loginAs('user1@com.au', '/admin/group/1');
    panel('Delete Group').within(() => {
      cy.get('input').type('nobody uses it');
      cy.contains('button', 'Request deletion').click();
      cy.contains('waiting for the super admin');
    });
  });
});
