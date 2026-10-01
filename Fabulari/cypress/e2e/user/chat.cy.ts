// User: Chat page (U8 to U14, U19)
describe('User: Chat page', () => {
  beforeEach(() => {
    cy.loginAs('user2@com.au');
    cy.waitForRoom();
  });

  it('U8: sends a message', () => {
    cy.sendMessage('Hello everyone');
    cy.get('.message').last().within(() => {
      cy.get('.sender').should('have.text', 'user2');
      cy.get('.message-text').should('have.text', 'Hello everyone');
      cy.get('.timestamp').invoke('text').should('match', /\d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)/);
    });
    cy.get('input[name=draft]').should('have.value', '');
  });

  it('U9: messages are kept for other users', () => {
    cy.sendMessage('Hi from user2');
    cy.contains('.message-text', 'Hi from user2');
    cy.loginAs('user1@com.au');
    cy.waitForRoom();
    cy.contains('.message-text', 'Hi from user2');
  });

  it('U10: only the last 5 messages are kept', () => {
    for (let i = 1; i <= 7; i++) {
      cy.sendMessage(`msg ${i}`);
      cy.contains('.message-text', `msg ${i}`);
    }
    cy.reload();
    cy.waitForRoom();
    cy.get('.message-text').should('have.length', 5);
    cy.get('.message-text').first().should('have.text', 'msg 3');
    cy.get('.message-text').last().should('have.text', 'msg 7');
  });

  it('U11: shows links and HTML as plain text', () => {
    cy.sendMessage('<b>bold</b> https://example.com');
    cy.get('.message-text').last().should('have.text', '<b>bold</b> https://example.com');
    cy.get('.messages-list a').should('not.exist');
    cy.get('.messages-list b').should('not.exist');
  });

  it('U12: sends a PNG image', () => {
    cy.get('form.message-input-row input[type=file]').selectFile('cypress/fixtures/sample.png', { force: true });
    cy.get('.message-image')
      .should('be.visible')
      .and(($img) => expect(($img[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0));
  });

  it('U13: refuses images that are not PNG', () => {
    cy.get('form.message-input-row input[type=file]').selectFile(
      { contents: Cypress.Buffer.from([0xff, 0xd8, 0xff, 0xe0]), fileName: 'photo.jpg', mimeType: 'image/jpeg' },
      { force: true },
    );
    cy.contains('.chat-error', 'Only PNG images can be sent.');
    cy.get('.message-image').should('not.exist');
  });

  it('U14: shows group members with the admin marked', () => {
    cy.get('.description-toggle').click();
    cy.contains('button', 'Members').click();
    cy.get('.member-list').should('contain', 'user1').and('contain', 'user2');
    cy.contains('.member-item', 'user1').find('.admin-badge').should('exist');
    cy.contains('.member-item', 'user2').find('.admin-badge').should('not.exist');
  });

  it('U19: requests a new room', () => {
    cy.get('.request-room-btn').click();
    cy.get('#roomRequestName').type('memes');
    cy.get('#roomRequestDescription').type('funny stuff only');
    cy.contains('form.room-request-form button', 'Send request').click();
    cy.contains('Request for "memes" sent to the help admins.');
    cy.get('form.room-request-form').should('not.exist');
  });
});
