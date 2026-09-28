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
import { Group, Message, PresenceEvent, Room } from '../models';

describe('Chat', () => {
  let fixture: ComponentFixture<Chat>;
  let http: HttpTestingController;
  let fakeChat: {
    messages$: Subject<Message>;
    presence$: Subject<PresenceUpdate>;
    activity$: Subject<PresenceEvent>;
    errors$: Subject<string>;
    joinRoom: ReturnType<typeof vi.fn>;
    leaveRoom: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
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
  const msg = (id: number, senderId: number, senderName: string, content: string, roomId = 1): Message => ({
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
      joinRoom: vi.fn(),
      leaveRoom: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
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
          useValue: { currentUser: signal({ id: 3, username: 'user2', role: 'user' }), logout: vi.fn() },
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
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[name=draft]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
    (fixture.nativeElement as HTMLElement).querySelector('form.message-input-row')!.dispatchEvent(new Event('submit'));
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
    const pick = (file: File) => ({ files: [file], value: 'C:\\fakepath\\x' }) as unknown as HTMLInputElement;
    const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'pic.png', { type: 'image/png' });

    it('uploads a PNG then sends it as an image message', async () => {
      await loadPage();
      const sending = (fixture.componentInstance as unknown as WithSendImage).sendImage(pick(png()));
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
      await (fixture.componentInstance as unknown as WithSendImage).sendImage(pick(png(2 * 1024 * 1024 + 1)));
      await settle();
      http.expectNone(`${API_URL}/rooms/1/images`);
      expect(text()).toContain('Images must be 2MB or smaller.');
    });

    it('shows the server error if the upload is rejected', async () => {
      await loadPage();
      const sending = (fixture.componentInstance as unknown as WithSendImage).sendImage(pick(png()));
      http
        .expectOne(`${API_URL}/rooms/1/images`)
        .flush({ message: 'Only PNG images are allowed' }, { status: 400, statusText: 'Bad Request' });
      await sending;
      await settle();
      expect(text()).toContain('Only PNG images are allowed');
      expect(fakeChat.sendMessage).not.toHaveBeenCalled();
    });

    it('shows image messages as images from the server', async () => {
      await loadPage();
      fakeChat.messages$.next({ ...msg(9, 2, 'user1', '/uploads/abc.png'), type: 'image' });
      await settle();
      const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.message-image');
      expect(img?.getAttribute('src')).toBe('http://localhost:3000/uploads/abc.png');
      expect(img?.getAttribute('alt')).toBe('Image sent by user1');
    });
  });

  it('leaves the old room when switching rooms', async () => {
    await loadPage();
    (fixture.componentInstance as unknown as { selectRoom(id: number): void }).selectRoom(2);
    expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
    expect(fakeChat.joinRoom).toHaveBeenLastCalledWith(2);
  });

  it('leaves the room when the page is closed', async () => {
    await loadPage();
    fixture.destroy();
    expect(fakeChat.leaveRoom).toHaveBeenCalledWith(1);
  });
});
