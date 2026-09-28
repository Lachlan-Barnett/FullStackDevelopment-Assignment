import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Socket } from 'socket.io-client';
import { ChatSocketService, SOCKET_FACTORY } from './chat-socket.service';
import { AuthService } from './auth.service';
import { SOCKET_URL } from '../api.config';
import { Message, PresenceEvent } from '../models';

// Minimal stand-in for a Socket.IO client socket.
class FakeSocket {
  connected = true;
  handlers = new Map<string, (data: unknown) => void>();
  emitted: { event: string; payload: unknown; ack?: (res: unknown) => void }[] = [];

  on(event: string, handler: (data: unknown) => void) {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, payload: unknown, ack?: (res: unknown) => void) {
    this.emitted.push({ event, payload, ack });
    return this;
  }

  disconnect() {
    this.connected = false;
    return this;
  }

  // Pretend the server sent an event.
  receive(event: string, data: unknown) {
    this.handlers.get(event)?.(data);
  }

  lastEmit() {
    return this.emitted[this.emitted.length - 1];
  }
}

describe('ChatSocketService', () => {
  let service: ChatSocketService;
  let socket: FakeSocket;
  let factory: ReturnType<typeof vi.fn>;
  const currentUser = signal<{ id: number } | null>({ id: 2 });
  let token: string | null;

  const message: Message = {
    id: 1,
    roomId: 5,
    senderId: 2,
    senderName: 'user1',
    type: 'text',
    content: 'hi',
    timestamp: '2026-09-28T00:00:00.000Z',
  };

  beforeEach(() => {
    socket = new FakeSocket();
    factory = vi.fn(() => socket as unknown as Socket);
    token = 'test-token';
    currentUser.set({ id: 2 });

    TestBed.configureTestingModule({
      providers: [
        { provide: SOCKET_FACTORY, useValue: factory },
        { provide: AuthService, useValue: { currentUser, getToken: () => token } },
      ],
    });
    service = TestBed.inject(ChatSocketService);
  });

  it('connects to the server with the login token', () => {
    service.connect();
    expect(factory).toHaveBeenCalledWith(SOCKET_URL, { auth: { token: 'test-token' } });
    expect(service.connected).toBe(true);
  });

  it('only opens one connection', () => {
    service.connect();
    service.connect();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does not connect when logged out', () => {
    token = null;
    service.connect();
    expect(factory).not.toHaveBeenCalled();
  });

  it('joins a room and resolves with history and who is present', async () => {
    const result = service.joinRoom(5);
    const sent = socket.lastEmit();
    expect(sent.event).toBe('room:join');
    expect(sent.payload).toEqual({ roomId: 5 });

    sent.ack!({ ok: true, history: [message], present: [{ userId: 2, username: 'user1' }] });
    await expect(result).resolves.toEqual({ history: [message], present: [{ userId: 2, username: 'user1' }] });
  });

  it('rejects a join the server refuses', async () => {
    const result = service.joinRoom(5);
    socket.lastEmit().ack!({ ok: false, message: 'Group members only' });
    await expect(result).rejects.toThrow('Group members only');
  });

  it('sends a message and resolves with the stored message', async () => {
    const result = service.sendMessage(5, 'text', 'hi');
    const sent = socket.lastEmit();
    expect(sent.event).toBe('message:send');
    expect(sent.payload).toEqual({ roomId: 5, type: 'text', content: 'hi' });

    sent.ack!({ ok: true, message });
    await expect(result).resolves.toEqual(message);
  });

  it('emits room:leave', () => {
    service.connect();
    service.leaveRoom(5);
    expect(socket.lastEmit()).toMatchObject({ event: 'room:leave', payload: { roomId: 5 } });
  });

  it('passes incoming messages to messages$', () => {
    const received: Message[] = [];
    service.messages$.subscribe((m) => received.push(m));
    service.connect();
    socket.receive('message:new', message);
    expect(received).toEqual([message]);
  });

  it('turns presence:joined and presence:left into activity$ events', () => {
    const received: PresenceEvent[] = [];
    service.activity$.subscribe((e) => received.push(e));
    service.connect();
    const user = { userId: 3, username: 'user2' };
    socket.receive('presence:joined', { roomId: 5, user });
    socket.receive('presence:left', { roomId: 5, user });
    expect(received).toEqual([
      { type: 'joined', roomId: 5, user },
      { type: 'left', roomId: 5, user },
    ]);
  });

  it('disconnects when the user logs out', () => {
    service.connect();
    currentUser.set(null);
    TestBed.tick();
    expect(socket.connected).toBe(false);
    expect(service.connected).toBe(false);
  });
});
