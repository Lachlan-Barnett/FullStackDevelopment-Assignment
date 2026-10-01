import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Socket } from 'socket.io-client';
import { ChatSocketService, SOCKET_FACTORY } from './chat-socket.service';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';
import { SOCKET_URL } from '../api.config';
import { NotificationService } from './notification.service';
import { Message, PresenceEvent, RefreshEvent, TypingEvent } from '../models';

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
  const logout = vi.fn();

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
        { provide: AuthService, useValue: { currentUser, getToken: () => token, logout } },
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
    await expect(result).resolves.toEqual({
      history: [message],
      present: [{ userId: 2, username: 'user1' }],
    });
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

  it('connects by itself as soon as someone is logged in', () => {
    TestBed.tick();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('passes refresh and typing events on to the pages', () => {
    const refreshes: RefreshEvent[] = [];
    const typing: TypingEvent[] = [];
    service.refresh$.subscribe((e) => refreshes.push(e));
    service.typing$.subscribe((e) => typing.push(e));
    service.connect();
    socket.receive('refresh', { scope: 'rooms', groupId: 1 });
    socket.receive('typing', { roomId: 5, user: { userId: 3, username: 'user2' }, typing: true });
    expect(refreshes).toEqual([{ scope: 'rooms', groupId: 1 }]);
    expect(typing[0].user.username).toBe('user2');
  });

  it('shows notifications from the server as pop-ups', () => {
    const show = vi.spyOn(TestBed.inject(NotificationService), 'show');
    service.connect();
    socket.receive('notification', { message: 'Your room "memes" in "help" was approved' });
    expect(show).toHaveBeenCalledWith('Your room "memes" in "help" was approved');
  });

  it('reports a lost connection and announces when it comes back', () => {
    let reconnects = 0;
    service.reconnected$.subscribe(() => reconnects++);
    service.connect();
    socket.receive('connect', undefined);
    expect(reconnects).toBe(0); // the first connection is not a reconnection
    socket.receive('disconnect', 'transport close');
    expect(service.connectionLost()).toBe(true);
    socket.receive('connect', undefined);
    expect(service.connectionLost()).toBe(false);
    expect(reconnects).toBe(1);
  });

  it('logs out and goes to the login page when the account is removed', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    service.connect();
    socket.receive('account:removed', {});
    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('sends typing events for a room', () => {
    service.connect();
    service.sendTyping(5, true);
    expect(socket.lastEmit()).toMatchObject({
      event: 'typing',
      payload: { roomId: 5, typing: true },
    });
  });

  it('disconnects when the user logs out', () => {
    service.connect();
    currentUser.set(null);
    TestBed.tick();
    expect(socket.connected).toBe(false);
    expect(service.connected).toBe(false);
  });
});
