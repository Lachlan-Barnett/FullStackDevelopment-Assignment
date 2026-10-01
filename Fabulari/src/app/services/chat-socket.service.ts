import { effect, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { io, ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { SOCKET_URL } from '../api.config';
import {
  Message,
  MessageType,
  PresenceEvent,
  PresentUser,
  RefreshEvent,
  TypingEvent,
} from '../models';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';

// How the service creates its socket. Tests replace this with a fake so no server is needed.
export type SocketFactory = (
  url: string,
  options: Partial<ManagerOptions & SocketOptions>,
) => Socket;
export const SOCKET_FACTORY = new InjectionToken<SocketFactory>('SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => io,
});

// Every acknowledgement from the server has this shape.
type Ack<T> = ({ ok: true } & T) | { ok: false; message: string };

export interface JoinResult {
  history: Message[]; // the last few stored messages for the room
  present: PresentUser[]; // who is in the room right now
}

export interface PresenceUpdate {
  roomId: number;
  users: PresentUser[];
}

// Wraps the Socket.IO connection, which is open whenever someone is logged in. It carries live chat, and
// also pop-up notifications and "refresh" events that keep every page up to date without reloading.
// Components subscribe to the Observables below; the service hides all the socket event names.
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly createSocket = inject(SOCKET_FACTORY);

  private socket: Socket | null = null;
  private hasConnected = false;

  private readonly messageSubject = new Subject<Message>();
  private readonly presenceSubject = new Subject<PresenceUpdate>();
  private readonly activitySubject = new Subject<PresenceEvent>();
  private readonly typingSubject = new Subject<TypingEvent>();
  private readonly refreshSubject = new Subject<RefreshEvent>();
  private readonly reconnectedSubject = new Subject<void>();
  private readonly errorSubject = new Subject<string>();

  /** New messages in any room this client has joined. */
  readonly messages$: Observable<Message> = this.messageSubject.asObservable();
  /** The full list of people in a room, sent whenever it changes. */
  readonly presence$: Observable<PresenceUpdate> = this.presenceSubject.asObservable();
  /** "X joined" / "X left" notices. */
  readonly activity$: Observable<PresenceEvent> = this.activitySubject.asObservable();
  /** "X is typing..." starting and stopping. */
  readonly typing$: Observable<TypingEvent> = this.typingSubject.asObservable();
  /** Something the open page shows has changed on the server, so it should reload it. */
  readonly refresh$: Observable<RefreshEvent> = this.refreshSubject.asObservable();
  /** The connection came back after being lost (e.g. the server restarted), so rooms must be rejoined. */
  readonly reconnected$: Observable<void> = this.reconnectedSubject.asObservable();
  /** Connection problems, e.g. an expired login. */
  readonly errors$: Observable<string> = this.errorSubject.asObservable();

  /** True while the connection is lost and Socket.IO is trying to reconnect. */
  readonly connectionLost = signal(false);

  // Ties the connection to the login: open while someone is logged in, closed as soon as they log out.
  constructor() {
    // Connect as soon as someone logs in, and drop the connection as soon as they log out.
    effect(() => {
      if (this.auth.currentUser()) this.connect();
      else this.disconnect();
    });
  }

  // Whether the socket is connected right now.
  get connected() {
    return this.socket?.connected ?? false;
  }

  // Opens the connection (once) with the login token and passes every server event on to the Observables.
  connect() {
    if (this.socket) return;
    const token = this.auth.getToken();
    if (!token) return;

    const socket = this.createSocket(SOCKET_URL, { auth: { token } });
    socket.on('message:new', (message: Message) => this.messageSubject.next(message));
    socket.on('presence:update', (update: PresenceUpdate) => this.presenceSubject.next(update));
    socket.on('presence:joined', (e: Omit<PresenceEvent, 'type'>) =>
      this.activitySubject.next({ ...e, type: 'joined' }),
    );
    socket.on('presence:left', (e: Omit<PresenceEvent, 'type'>) =>
      this.activitySubject.next({ ...e, type: 'left' }),
    );
    socket.on('typing', (e: TypingEvent) => this.typingSubject.next(e));
    socket.on('refresh', (e: RefreshEvent) => this.refreshSubject.next(e));
    socket.on('notification', (n: { message: string }) => this.notifications.show(n.message));
    socket.on('account:removed', () => this.accountRemoved());
    socket.on('connect_error', (err: Error) => this.errorSubject.next(err.message));
    socket.on('connect', () => this.onConnect());
    socket.on('disconnect', () => {
      if (this.socket === socket) this.connectionLost.set(true);
    });
    this.socket = socket;
  }

  // Closes the connection on purpose (logging out), which is not shown as a lost connection.
  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.hasConnected = false;
    this.connectionLost.set(false);
  }

  /** Joins a room's live feed. Resolves with its recent history and who is present. */
  joinRoom(roomId: number): Promise<JoinResult> {
    return this.request<JoinResult>('room:join', { roomId });
  }

  // Leaves a room's live feed.
  leaveRoom(roomId: number) {
    this.socket?.emit('room:leave', { roomId });
  }

  /** Sends a message to a joined room. Resolves with the message as stored by the server. */
  sendMessage(roomId: number, type: MessageType, content: string): Promise<Message> {
    return this.request<{ message: Message }>('message:send', { roomId, type, content }).then(
      (r) => r.message,
    );
  }

  // Tells the others in the room that this user started or stopped typing.
  sendTyping(roomId: number, typing: boolean) {
    this.socket?.emit('typing', { roomId, typing });
  }

  // The first connect is normal; any later one means the connection was lost and has come back.
  private onConnect() {
    if (this.hasConnected) this.reconnectedSubject.next();
    this.hasConnected = true;
    this.connectionLost.set(false);
  }

  // The super admin removed this account from Fabulari: log out and say why.
  private accountRemoved() {
    this.notifications.show('Your account has been removed from Fabulari by the super admin.');
    this.auth.logout();
    this.router.navigateByUrl('/');
  }

  // Emits an event and waits for the server's acknowledgement, turning { ok: false } into a rejection.
  private request<T>(event: string, payload: object): Promise<T> {
    this.connect();
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('Not logged in'));
    return new Promise<T>((resolve, reject) => {
      socket.emit(event, payload, (ack: Ack<T>) => {
        if (ack.ok) {
          const { ok, ...data } = ack;
          resolve(data as T);
        } else {
          reject(new Error(ack.message));
        }
      });
    });
  }
}
