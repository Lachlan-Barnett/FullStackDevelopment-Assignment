import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Chat } from './chat';
import { AuthService } from '../services/auth.service';
import { ChatSocketService, PresenceUpdate } from '../services/chat-socket.service';
import { API_URL } from '../api.config';
import { Group, Message, PresenceEvent, RefreshEvent, Room, TypingEvent } from '../models';

describe('Chat', () => {
  let fixture: ComponentFixture<Chat>;
  let http: HttpTestingController;
  let fakeChat: {
    messages$: Subject<Message>;
    presence$: Subject<PresenceUpdate>;
    activity$: Subject<PresenceEvent>;
    errors$: Subject<string>;
    typing$: Subject<TypingEvent>;
    refresh$: Subject<RefreshEvent>;
    reconnected$: Subject<void>;
    connectionLost: ReturnType<typeof signal<boolean>>;
    joinRoom: ReturnType<typeof vi.fn>;
    leaveRoom: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    sendTyping: ReturnType<typeof vi.fn>;
  };

  const group: Group = {
    id: 1,
    name: 'help',
    description: 'anything',
    ageLimit: 13,
    colourTheme: 'Blue',
    members: [
      { userId: 2, role: 'admin' },
      { userId: 3, role: 'member' },
    ],
  };
  const rooms: Room[] = [
    { id: 1, groupId: 1, name: 'start', description: '' },
    { id: 2, groupId: 1, name: 'memes', description: '' },
  ];
  const msg = (
    id: number,
    senderId: number,
    senderName: string,
    content: string,
    roomId = 1,
  ): Message => ({
    id,
    roomId,
    senderId,
    senderName,
    type: 'text',
    content,
    timestamp: '2026-09-28T01:00:00.000Z',
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // Loads the page as user2 (a plain member) and answers the group/room/member requests.
  async function loadPage(history: Message[] = []) {
    fakeChat.joinRoom.mockResolvedValue({ history, present: [{ userId: 3, username: 'user2' }] });
    fixture = TestBed.createComponent(Chat);
    fixture.detectChanges();
    http.expectOne(`${API_URL}/groups`).flush([group]);
    http.expectOne(`${API_URL}/groups/1/rooms`).flush(rooms);
    http.expectOne(`${API_URL}/groups/1/members`).flush([]);
    await settle();
  }

  beforeEach(() => {
    fakeChat = {
      messages$: new Subject(),
      presence$: new Subject(),
      activity$: new Subject(),
      errors$: new Subject(),
      typing$: new Subject(),
      refresh$: new Subject(),
      reconnected$: new Subject(),
      connectionLost: signal(false),
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendTyping: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [Chat],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ChatSocketService, useValue: fakeChat },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 3, username: 'user2', role: 'user' }),
            logout: vi.fn(),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('joins the first room of the first group and shows who is present', async () => {
    await loadPage();
    expect(fakeChat.joinRoom).toHaveBeenCalledWith(1);
    expect(text()).toContain('# start');
    expect(text()).toContain('In this room:');
    expect(text()).toContain('user2');
  });

  it('shows the room history returned when joining', async () => {
    await loadPage([msg(1, 3, 'user2', 'earlier message')]);
    expect(text()).toContain('earlier message');
  });

  it('shows live messages for the current room with an Admin badge for admins', async () => {
    await loadPage();
    fakeChat.messages$.next(msg(5, 2, 'user1', 'hello from the admin'));
    fakeChat.messages$.next(msg(6, 2, 'user1', 'wrong room', 2));
    await settle();

    expect(text()).toContain('hello from the admin');
    expect(text()).not.toContain('wrong room');
    const badges = (fixture.nativeElement as HTMLElement).querySelectorAll('.message .admin-badge');
    expect(badges.length).toBe(1);
  });

  it("shows the sender's profile photo, or their initial when they have none", async () => {
    await loadPage();
    fakeChat.messages$.next({
      ...msg(7, 2, 'user1', 'with photo'),
      senderPhoto: '/uploads/avatars/2.png?v=1',
    });
    fakeChat.messages$.next(msg(8, 3, 'user2', 'no photo'));
    await settle();
    const avatars = (fixture.nativeElement as HTMLElement).querySelectorAll('.message .avatar');
    expect(avatars[0].tagName).toBe('IMG');
    expect(avatars[0].getAttribute('src')).toBe('http://localhost:3000/uploads/avatars/2.png?v=1');
    expect(avatars[1].tagName).toBe('DIV');
    expect(avatars[1].textContent?.trim()).toBe('U');
  });

  it('shows join and leave notices', async () => {
    await loadPage();
    const user = { userId: 2, username: 'user1' };
    fakeChat.activity$.next({ type: 'joined', roomId: 1, user });
    fakeChat.activity$.next({ type: 'left', roomId: 1, user });
    await settle();
    expect(text()).toContain('user1 joined the room');
    expect(text()).toContain('user1 left the room');
  });

  // Types into the real input and submits the real form, like a user would.
  async function typeAndSend(value: string) {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[name=draft]',
    )!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
    (fixture.nativeElement as HTMLElement)
      .querySelector('form.message-input-row')!
      .dispatchEvent(new Event('submit'));
    await settle();
    return input;
  }

  it('sends the typed message to the current room and clears the box on screen', async () => {
    await loadPage();
    const input = await typeAndSend('  hi all  ');
    expect(fakeChat.sendMessage).toHaveBeenCalledWith(1, 'text', 'hi all');
    expect(input.value).toBe('');
  });

  it('shows the server error and keeps the text when sending fails', async () => {
    await loadPage();
    fakeChat.sendMessage.mockRejectedValue(new Error('Group members only'));
    const input = await typeAndSend('hi');
    expect(text()).toContain('Group members only');
    expect(input.value).toBe('hi');
  });

  describe('images', () => {
    type WithSendImage = { sendImage(input: HTMLInputElement): Promise<void> };
    const pick = (file: File) =>
      ({ files: [file], value: 'C:\\fakepath\\x' }) as unknown as HTMLInputElement;
    const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'pic.png', { type: 'image/png' });

    it('uploads a PNG then sends it as an image message', async () => {
      await loadPage();
      const sending = (fixture.componentInstance as unknown as WithSendImage).sendImage(
        pick(png()),
      );
      const upload = http.expectOne(`${API_URL}/rooms/1/images`);
      expect(upload.request.method).toBe('POST');
      expect((upload.request.body as FormData).get('image')).toBeInstanceOf(File);
      upload.flush({ url: '/uploads/abc.png' });
      await sending;
      expect(fakeChat.sendMessage).toHaveBeenCalledWith(1, 'image', '/uploads/abc.png');
    });

    it('refuses non-PNG files without uploading', async () => {
      await loadPage();
      const jpg = new File([new Uint8Array(10)], 'pic.jpg', { type: 'image/jpeg' });
      await (fixture.componentInstance as unknown as WithSendImage).sendImage(pick(jpg));
      await settle();
      http.expectNone(`${API_URL}/rooms/1/images`);
      expect(text()).toContain('Only PNG images can be sent.');
    });

    it('refuses images over 2MB without uploading', async () => {
      await loadPage();
      await (fixture.componentInstance as unknown as WithSendImage).sendImage(
        pick(png(2 * 1024 * 1024 + 1)),
      );
      await settle();
      http.expectNone(`${API_URL}/rooms/1/images`);
      expect(text()).toContain('Images must be 2MB or smaller.');
    });

    it('shows the server error if the upload is rejected', async () => {
      await loadPage();
      const sending = (fixture.componentInstance as unknown as WithSendImage).sendImage(
        pick(png()),
      );
      http
        .expectOne(`${API_URL}/rooms/1/images`)
        .flush(
          { message: 'Only PNG images are allowed' },
          { status: 400, statusText: 'Bad Request' },
        );
      await sending;
      await settle();
      expect(text()).toContain('Only PNG images are allowed');
      expect(fakeChat.sendMessage).not.toHaveBeenCalled();
    });

    it('shows image messages as images from the server', async () => {
      await loadPage();
      fakeChat.messages$.next({ ...msg(9, 2, 'user1', '/uploads/abc.png'), type: 'image' });
      await settle();
      const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
        '.message-image',
      );
      expect(img?.getAttribute('src')).toBe('http://localhost:3000/uploads/abc.png');
      expect(img?.getAttribute('alt')).toBe('Image sent by user1');
    });
  });

  describe('requesting a room', () => {
    const el = () => fixture.nativeElement as HTMLElement;
    const requestButton = () => el().querySelector<HTMLButtonElement>('.request-room-btn')!;
    async function fill(id: string, value: string) {
      const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    }
    async function submit() {
      el().querySelector('form.room-request-form')!.dispatchEvent(new Event('submit'));
      await settle();
    }

    beforeEach(async () => {
      await loadPage();
      requestButton().click();
      await settle();
    });

    it('opens a labelled form for the selected group', () => {
      expect(el().textContent).toContain('Request a new room in help');
      expect(el().querySelector('label[for=roomRequestName]')).not.toBeNull();
      expect(requestButton().textContent?.trim()).toBe('Cancel');
      expect(requestButton().getAttribute('aria-expanded')).toBe('true');
    });

    it('sends the request to the group and confirms', async () => {
      await fill('roomRequestName', '  memes  ');
      await fill('roomRequestDescription', 'funny stuff');
      await submit();

      const req = http.expectOne(`${API_URL}/groups/1/room-requests`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ name: 'memes', description: 'funny stuff' });
      req.flush({ id: 3, name: 'memes' });
      await settle();

      expect(el().textContent).toContain('Request for "memes" sent to the help admins.');
      expect(el().querySelector('form.room-request-form')).toBeNull();
      expect(requestButton().textContent?.trim()).toBe('Request room');
    });

    it('needs a name', async () => {
      await submit();
      expect(el().textContent).toContain('Please give the room a name.');
      http.expectNone(`${API_URL}/groups/1/room-requests`);
    });

    it('shows the server error and keeps the form open', async () => {
      await fill('roomRequestName', 'start');
      await submit();
      http
        .expectOne(`${API_URL}/groups/1/room-requests`)
        .flush(
          { message: 'This group already has a room with that name' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();
      expect(el().textContent).toContain('This group already has a room with that name');
      expect(el().querySelector<HTMLInputElement>('#roomRequestName')!.value).toBe('start');
    });
  });

  it('leaves the old room when switching rooms', async () => {
    await loadPage();
    (fixture.componentInstance as unknown as { selectRoom(id: number): void }).selectRoom(2);
    expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
    expect(fakeChat.joinRoom).toHaveBeenLastCalledWith(2);
  });

  describe('typing indicator', () => {
    it('shows who is typing in the open room, and clears it when they stop or send', async () => {
      await loadPage();
      const user1 = { userId: 2, username: 'user1' };
      fakeChat.typing$.next({ roomId: 1, user: user1, typing: true });
      await settle();
      expect(text()).toContain('user1 is typing…');
      fakeChat.typing$.next({ roomId: 1, user: user1, typing: false });
      await settle();
      expect(text()).not.toContain('is typing');
      fakeChat.typing$.next({ roomId: 1, user: user1, typing: true });
      fakeChat.messages$.next(msg(9, 2, 'user1', 'done typing'));
      await settle();
      expect(text()).not.toContain('is typing');
    });

    it('names two people, then says several', async () => {
      await loadPage();
      fakeChat.typing$.next({ roomId: 1, user: { userId: 2, username: 'user1' }, typing: true });
      fakeChat.typing$.next({ roomId: 1, user: { userId: 4, username: 'carol' }, typing: true });
      await settle();
      expect(text()).toContain('user1 and carol are typing…');
      fakeChat.typing$.next({ roomId: 1, user: { userId: 5, username: 'dave' }, typing: true });
      await settle();
      expect(text()).toContain('Several people are typing…');
    });

    it('ignores typing in other rooms', async () => {
      await loadPage();
      fakeChat.typing$.next({ roomId: 2, user: { userId: 2, username: 'user1' }, typing: true });
      await settle();
      expect(text()).not.toContain('is typing');
    });

    it('tells the room once when you start typing, and when you send', async () => {
      await loadPage();
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        'input[name=draft]',
      )!;
      for (const value of ['h', 'he', 'hey']) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      expect(fakeChat.sendTyping).toHaveBeenCalledTimes(1);
      expect(fakeChat.sendTyping).toHaveBeenCalledWith(1, true);
      (fixture.nativeElement as HTMLElement)
        .querySelector('form.message-input-row')!
        .dispatchEvent(new Event('submit'));
      await settle();
      expect(fakeChat.sendTyping).toHaveBeenLastCalledWith(1, false);
    });
  });

  describe('live updates', () => {
    it('reloads the rooms when one is added, keeping the open room', async () => {
      await loadPage();
      fakeChat.refresh$.next({ scope: 'rooms', groupId: 1 });
      http
        .expectOne(`${API_URL}/groups/1/rooms`)
        .flush([...rooms, { id: 3, groupId: 1, name: 'news', description: '' }]);
      await settle();
      expect(text()).toContain('news');
      expect(fakeChat.joinRoom).toHaveBeenCalledTimes(1);
    });

    it('moves to another room when the open one is deleted', async () => {
      await loadPage();
      fakeChat.refresh$.next({ scope: 'rooms', groupId: 1 });
      http.expectOne(`${API_URL}/groups/1/rooms`).flush([rooms[1]]);
      await settle();
      expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
      expect(fakeChat.joinRoom).toHaveBeenLastCalledWith(2);
    });

    it('leaves the group straight away when removed from it', async () => {
      await loadPage();
      fakeChat.refresh$.next({ scope: 'groups' });
      http.expectOne(`${API_URL}/groups`).flush([]);
      await settle();
      expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
      expect(text()).toContain('Join a group to start chatting.');
    });

    it('keeps the open group when the group list reloads', async () => {
      await loadPage();
      fakeChat.refresh$.next({ scope: 'groups' });
      http.expectOne(`${API_URL}/groups`).flush([{ ...group, name: 'help desk' }]);
      http.expectOne(`${API_URL}/groups/1/members`).flush([]);
      await settle();
      expect(text()).toContain('help desk');
      expect(fakeChat.joinRoom).toHaveBeenCalledTimes(1);
    });

    it('rejoins the open room when the connection comes back', async () => {
      await loadPage();
      fakeChat.reconnected$.next();
      await settle();
      expect(fakeChat.joinRoom).toHaveBeenCalledTimes(2);
      expect(fakeChat.joinRoom).toHaveBeenLastCalledWith(1);
    });

    it('shows a banner while the connection is lost', async () => {
      await loadPage();
      fakeChat.connectionLost.set(true);
      await settle();
      expect(text()).toContain('Connection lost. Reconnecting');
    });
  });

  describe('image viewer', () => {
    const image: Message = { ...msg(7, 2, 'user1', '/uploads/pic.png'), type: 'image' };

    it('opens an image full size and closes with Escape', async () => {
      await loadPage([image]);
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('.image-btn')!.click();
      await settle();
      expect(document.querySelector('.image-viewer img')?.getAttribute('src')).toContain(
        '/uploads/pic.png',
      );
      expect(document.querySelector('.image-viewer')?.textContent).toContain('Sent by user1');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(document.querySelector('.image-viewer')).toBeNull();
    });

    it('closes with the Close button', async () => {
      await loadPage([image]);
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('.image-btn')!
        .click();
      await settle();
      document.querySelector<HTMLButtonElement>('.image-viewer-close')!.click();
      await settle();
      expect(document.querySelector('.image-viewer')).toBeNull();
    });
  });

  it('leaves the room when the page is closed', async () => {
    await loadPage();
    fixture.destroy();
    expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
  });
});
