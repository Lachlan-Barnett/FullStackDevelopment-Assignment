import { effect, inject, Injectable, InjectionToken } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { SOCKET_URL } from '../api.config';
import { Message, MessageType, PresenceEvent, PresentUser } from '../models';
import { AuthService } from './auth.service';

// How the service creates its socket. Tests replace this with a fake so no server is needed.
export type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => Socket;
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

export interface ChatNotification {
  message: string;
}

// Wraps the Socket.IO connection used for live chat. Components subscribe to the
// Observables below; the service hides all the socket event names.
@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  private readonly auth = inject(AuthService);
  private readonly createSocket = inject(SOCKET_FACTORY);

  private socket: Socket | null = null;

  private readonly messageSubject = new Subject<Message>();
  private readonly presenceSubject = new Subject<PresenceUpdate>();
  private readonly activitySubject = new Subject<PresenceEvent>();
  private readonly notificationSubject = new Subject<ChatNotification>();
  private readonly errorSubject = new Subject<string>();

  /** New messages in any room this client has joined. */
  readonly messages$: Observable<Message> = this.messageSubject.asObservable();
  /** The full list of people in a room, sent whenever it changes. */
  readonly presence$: Observable<PresenceUpdate> = this.presenceSubject.asObservable();
  /** "X joined" / "X left" notices. */
  readonly activity$: Observable<PresenceEvent> = this.activitySubject.asObservable();
  /** Pushed notifications, e.g. a request being approved. */
  readonly notifications$: Observable<ChatNotification> = this.notificationSubject.asObservable();
  /** Connection problems, e.g. an expired login. */
  readonly errors$: Observable<string> = this.errorSubject.asObservable();

  constructor() {
    // Drop the connection as soon as the user logs out.
    effect(() => {
      if (!this.auth.currentUser()) this.disconnect();
    });
  }

  get connected() {
    return this.socket?.connected ?? false;
  }

  connect() {
    if (this.socket) return;
    const token = this.auth.getToken();
    if (!token) return;

    const socket = this.createSocket(SOCKET_URL, { auth: { token } });
    socket.on('message:new', (message: Message) => this.messageSubject.next(message));
    socket.on('presence:update', (update: PresenceUpdate) => this.presenceSubject.next(update));
    socket.on('presence:joined', (e: Omit<PresenceEvent, 'type'>) => this.activitySubject.next({ ...e, type: 'joined' }));
    socket.on('presence:left', (e: Omit<PresenceEvent, 'type'>) => this.activitySubject.next({ ...e, type: 'left' }));
    socket.on('notification', (n: ChatNotification) => this.notificationSubject.next(n));
    socket.on('connect_error', (err: Error) => this.errorSubject.next(err.message));
    this.socket = socket;
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  /** Joins a room's live feed. Resolves with its recent history and who is present. */
  joinRoom(roomId: number): Promise<JoinResult> {
    return this.request<JoinResult>('room:join', { roomId });
  }

  leaveRoom(roomId: number) {
    this.socket?.emit('room:leave', { roomId });
  }

  /** Sends a message to a joined room. Resolves with the message as stored by the server. */
  sendMessage(roomId: number, type: MessageType, content: string): Promise<Message> {
    return this.request<{ message: Message }>('message:send', { roomId, type, content }).then((r) => r.message);
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
