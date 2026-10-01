// User: Settings pages (U23 to U26)
describe('User: Settings pages', () => {
  it('U23: dark mode is saved', () => {
    cy.loginAs('user2@com.au', '/settings');
    cy.get('#dark-mode').check();
    cy.get('body').should('have.class', 'dark-theme');
    cy.reload();
    cy.get('body').should('have.class', 'dark-theme');
  });

  it('U24: changes the username', () => {
    cy.loginAs('user2@com.au', '/settings');
    cy.contains('button', 'Change Username').click();
    cy.get('#newUsername').type('robin');
    cy.contains('button', 'Submit').click();
    cy.location('pathname').should('eq', '/settings');
    cy.contains('.field-box', 'robin');
    cy.visit('/chat');
    cy.waitForRoom();
    cy.sendMessage('renamed');
    cy.get('.message').last().find('.sender').should('have.text', 'robin');
  });

  it('U25: changes the password', () => {
    cy.loginAs('user2@com.au', '/change-password');
    const fill = (current: string, next: string, confirm: string) => {
      cy.get('#currentPassword').clear().type(current);
      cy.get('#newPassword').clear().type(next);
      cy.get('#confirmPassword').clear().type(confirm);
      cy.contains('button', 'Submit').click();
    };

    fill('123', 'abc123', 'xyz789');
    cy.contains('.alert', 'New passwords do not match.');
    fill('wrong', 'abc123', 'abc123');
    cy.contains('.alert', 'Current password is incorrect');
    fill('123', 'abc123', 'abc123');
    cy.location('pathname').should('eq', '/settings');

    cy.clearLocalStorage();
    cy.visit('/');
    cy.get('#email').type('user2@com.au');
    cy.get('#password').type('abc123');
    cy.get('button[type=submit]').click();
    cy.location('pathname').should('eq', '/chat');
  });

  it('U26: adds and removes a profile photo', () => {
    cy.loginAs('user2@com.au', '/settings');
    cy.get('.photo-actions input[type=file]').selectFile('cypress/fixtures/sample.png', { force: true });
    cy.get('img.avatar-large').should('be.visible');

    cy.visit('/chat');
    cy.waitForRoom();
    cy.sendMessage('new photo');
    cy.get('.message').last().find('img.avatar').should('exist');

    cy.visit('/settings');
    cy.contains('button', 'Remove').click();
    cy.get('.avatar-initial').should('exist');
  });
});
