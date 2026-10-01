import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ChatSocketService } from '../services/chat-socket.service';
import { API_URL, SERVER_URL } from '../api.config';
import {
  Group,
  GroupMemberDetails,
  Message,
  PresentUser,
  Room,
  RoomRequest,
  THEME_TINTS,
} from '../models';
import { LIMITS } from '../validation';

// Client limits for image messages: PNG only, at most 2MB. The server checks these again.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// How long after the last key press "X is typing..." is cleared, on this side and for everyone else.
const TYPING_IDLE_MS = 3000;
const TYPING_EXPIRY_MS = 6000;

// The server's message for an HTTP or socket error, or a fallback.
function errorMessage(err: unknown, fallback: string) {
  if (err instanceof HttpErrorResponse) return err.error?.message ?? fallback;
  return err instanceof Error ? err.message : fallback;
}

type InfoTab = 'info' | 'age' | 'colour' | 'members';

// The message area shows chat messages mixed with "X joined / X left" notices.
type FeedItem =
  | { kind: 'message'; key: string; message: Message }
  | { kind: 'notice'; key: string; text: string };

// The main page: the user's groups and rooms, the live messages of the open room, who is in it,
// "X is typing...", the message box (text and PNG images), requesting a room, and the group's details.
@Component({
  selector: 'app-chat',
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
  host: { '(document:keydown.escape)': 'closeImage()' },
})
export class Chat {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatSocketService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly currentUser = this.auth.currentUser;
  protected readonly myGroups = signal<Group[]>([]);
  protected readonly rooms = signal<Room[]>([]);
  protected readonly members = signal<GroupMemberDetails[]>([]);

  protected readonly selectedGroupId = signal<number | null>(null);
  protected readonly selectedRoomId = signal<number | null>(null);
  protected readonly showDescription = signal(false);
  protected readonly showGroups = signal(true);
  protected readonly infoTab = signal<InfoTab>('info');

  // Live chat state for the room currently open.
  protected readonly feed = signal<FeedItem[]>([]);
  protected readonly present = signal<PresentUser[]>([]);
  protected readonly chatError = signal('');
  protected readonly uploading = signal(false);
  protected readonly connectionLost = this.chat.connectionLost;

  // Who else is typing in the open room: userId -> username.
  private readonly typers = signal(new Map<number, string>());
  private readonly typerTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private typingSent = false;
  private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // "user1 is typing...", "user1 and user2 are typing..." or "Several people are typing...".
  protected readonly typingText = computed(() => {
    const names = [...this.typers().values()];
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return 'Several people are typing…';
  });

  // The image shown full size in the viewer, if any.
  protected readonly viewedImage = signal<Message | null>(null);
  private readonly viewerClose = viewChild<ElementRef<HTMLButtonElement>>('viewerClose');

  // "Request room" form: members propose a room for the selected group; an admin approves or rejects it.
  protected readonly showRoomRequest = signal(false);
  protected readonly roomRequestName = signal('');
  protected readonly roomRequestDescription = signal('');
  protected readonly roomRequestError = signal('');
  protected readonly roomRequestSuccess = signal('');
  protected readonly roomRequestSending = signal(false);
  protected readonly draft = signal('');
  protected readonly limits = LIMITS;

  private readonly messageList = viewChild<ElementRef<HTMLElement>>('messageList');
  private joinedRoomId: number | null = null;
  private noticeCount = 0;

  protected readonly selectedGroup = computed(
    () => this.myGroups().find((g) => g.id === this.selectedGroupId()) ?? null,
  );

  protected readonly selectedRoom = computed(
    () => this.rooms().find((r) => r.id === this.selectedRoomId()) ?? null,
  );

  protected readonly isGroupAdmin = computed(() => {
    const user = this.currentUser();
    const group = this.selectedGroup();
    if (!user || !group) return false;
    return group.members.some((m) => m.userId === user.id && m.role === 'admin');
  });

  // Ids of the selected group's admins, for the "Admin" badge on their messages.
  protected readonly adminIds = computed(
    () =>
      new Set(
        this.selectedGroup()
          ?.members.filter((m) => m.role === 'admin')
          .map((m) => m.userId) ?? [],
      ),
  );

  protected readonly themeTint = computed(() => {
    const theme = this.selectedGroup()?.colourTheme;
    return theme ? THEME_TINTS[theme] : null;
  });

  // Subscribes to the live socket events. Each one only affects the room that is open.
  constructor() {
    this.chat.messages$.pipe(takeUntilDestroyed()).subscribe((message) => {
      if (message.roomId !== this.joinedRoomId) return;
      this.stopShowingTyping(message.senderId);
      this.feed.update((items) => [...items, { kind: 'message', key: `m${message.id}`, message }]);
    });

    this.chat.presence$.pipe(takeUntilDestroyed()).subscribe(({ roomId, users }) => {
      if (roomId === this.joinedRoomId) this.present.set(users);
    });

    this.chat.activity$.pipe(takeUntilDestroyed()).subscribe(({ type, roomId, user }) => {
      if (roomId !== this.joinedRoomId) return;
      this.addNotice(`${user.username} ${type === 'joined' ? 'joined' : 'left'} the room`);
    });

    this.chat.typing$.pipe(takeUntilDestroyed()).subscribe(({ roomId, user, typing }) => {
      if (roomId !== this.joinedRoomId || user.userId === this.currentUser()?.id) return;
      if (typing) this.showTyping(user);
      else this.stopShowingTyping(user.userId);
    });

    // The server says something changed: reload the groups (kept selected) or the open group's rooms.
    this.chat.refresh$.pipe(takeUntilDestroyed()).subscribe(({ scope, groupId }) => {
      if (scope === 'groups') this.loadGroups();
      if (scope === 'rooms' && groupId !== undefined && groupId === this.selectedGroupId())
        this.loadRooms(groupId);
    });

    // After a lost connection comes back the server has forgotten which room this tab was in, so rejoin it.
    this.chat.reconnected$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.joinedRoomId !== null) this.joinRoom(this.joinedRoomId);
    });

    this.chat.errors$
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.chatError.set(message));

    // Keep the newest message in view.
    afterRenderEffect(() => {
      this.feed();
      const list = this.messageList()?.nativeElement;
      if (list) list.scrollTop = list.scrollHeight;
    });

    this.destroyRef.onDestroy(() => {
      this.leaveCurrentRoom();
      if (this.typingIdleTimer) clearTimeout(this.typingIdleTimer);
    });
  }

  // Loads the user's groups when the page opens.
  ngOnInit() {
    this.loadGroups();
  }

  // Loads the groups the user belongs to. The selected group stays selected if the user is still in it;
  // otherwise (first load, or they just left, were banned or the group was deleted) the first group opens.
  private loadGroups() {
    const user = this.currentUser();
    if (!user) return;

    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => {
        const mine = groups.filter((g) => g.members.some((m) => m.userId === user.id));
        this.myGroups.set(mine);
        const selected = this.selectedGroupId();
        if (selected !== null && mine.some((g) => g.id === selected)) {
          this.loadMembers(selected); // names and admin badges may have changed
        } else if (mine.length) {
          this.selectGroup(mine[0].id);
        } else {
          this.selectedGroupId.set(null);
          this.rooms.set([]);
          this.members.set([]);
          this.selectRoom(null);
        }
      },
    });
  }

  // Loads a group's rooms. The open room stays open if it still exists, otherwise the first room opens.
  private loadRooms(groupId: number) {
    this.http.get<Room[]>(`${API_URL}/groups/${groupId}/rooms`).subscribe({
      next: (rooms) => {
        if (groupId !== this.selectedGroupId()) return; // the user has moved to another group
        this.rooms.set(rooms);
        const open = this.selectedRoomId();
        if (open === null || !rooms.some((r) => r.id === open)) {
          this.selectRoom(rooms.length ? rooms[0].id : null);
        }
      },
    });
  }

  // The group's members, for the Members tab. Admins first, then alphabetical.
  private loadMembers(groupId: number) {
    this.http.get<GroupMemberDetails[]>(`${API_URL}/groups/${groupId}/members`).subscribe({
      next: (members) =>
        this.members.set(
          [...members].sort(
            (a, b) =>
              Number(b.role === 'admin') - Number(a.role === 'admin') ||
              (a.username ?? '').localeCompare(b.username ?? ''),
          ),
        ),
    });
  }

  // Opens or closes the "Request room" form.
  toggleRoomRequest() {
    this.showRoomRequest.update((v) => !v);
    this.roomRequestError.set('');
    this.roomRequestSuccess.set('');
  }

  // Checks the form and asks the group's admins for a new room.
  submitRoomRequest() {
    const group = this.selectedGroup();
    const name = this.roomRequestName().trim();
    this.roomRequestError.set('');
    this.roomRequestSuccess.set('');
    if (!group) return;
    if (!name) {
      this.roomRequestError.set('Please give the room a name.');
      return;
    }
    if (name.length > LIMITS.name) {
      this.roomRequestError.set(`Room names can be at most ${LIMITS.name} characters.`);
      return;
    }

    this.roomRequestSending.set(true);
    this.http
      .post<RoomRequest>(`${API_URL}/groups/${group.id}/room-requests`, {
        name,
        description: this.roomRequestDescription().trim(),
      })
      .subscribe({
        next: (request) => {
          this.roomRequestSending.set(false);
          this.roomRequestSuccess.set(
            `Request for "${request.name}" sent to the ${group.name} admins.`,
          );
          this.roomRequestName.set('');
          this.roomRequestDescription.set('');
          this.showRoomRequest.set(false);
        },
        error: (err) => {
          this.roomRequestSending.set(false);
          this.roomRequestError.set(errorMessage(err, 'Unable to send that request.'));
        },
      });
  }

  // Opens a group: its rooms (the first one is joined) and its members.
  selectGroup(id: number) {
    // The form and its messages belong to the previous group.
    this.showRoomRequest.set(false);
    this.roomRequestError.set('');
    this.roomRequestSuccess.set('');

    this.selectedGroupId.set(id);
    this.members.set([]);
    this.rooms.set([]);
    this.selectRoom(null);
    this.loadRooms(id);
    this.loadMembers(id);
  }

  // Opens a room: leaves the old one's live feed and joins the new one's.
  selectRoom(id: number | null) {
    if (id === this.joinedRoomId && id !== null) return;
    this.selectedRoomId.set(id);
    this.leaveCurrentRoom();
    if (id !== null) this.joinRoom(id);
  }

  // Joins a room over the socket and shows its stored history and who is present.
  private async joinRoom(roomId: number) {
    this.joinedRoomId = roomId;
    this.chatError.set('');
    try {
      const { history, present } = await this.chat.joinRoom(roomId);
      if (this.joinedRoomId !== roomId) return; // the user already moved to another room
      this.feed.set(
        history.map((message) => ({ kind: 'message', key: `m${message.id}`, message })),
      );
      this.present.set(present);
    } catch (err) {
      if (this.joinedRoomId === roomId) {
        this.chatError.set(err instanceof Error ? err.message : 'Unable to join this room.');
      }
    }
  }

  // Leaves the open room's live feed and clears what was shown for it.
  private leaveCurrentRoom() {
    if (this.joinedRoomId !== null) {
      if (this.typingSent) this.chat.sendTyping(this.joinedRoomId, false);
      this.chat.leaveRoom(this.joinedRoomId);
    }
    this.joinedRoomId = null;
    this.typingSent = false;
    this.feed.set([]);
    this.present.set([]);
    this.typers.set(new Map());
  }

  // Adds a "X joined the room" style notice to the feed.
  private addNotice(text: string) {
    this.feed.update((items) => [
      ...items,
      { kind: 'notice', key: `n${++this.noticeCount}`, text },
    ]);
  }

  // Shows "X is typing..." until they stop, send a message, or go quiet for a while.
  private showTyping(user: PresentUser) {
    this.typers.update((typers) => new Map(typers).set(user.userId, user.username));
    clearTimeout(this.typerTimers.get(user.userId));
    this.typerTimers.set(
      user.userId,
      setTimeout(() => this.stopShowingTyping(user.userId), TYPING_EXPIRY_MS),
    );
  }

  // Removes someone from "X is typing...".
  private stopShowingTyping(userId: number) {
    clearTimeout(this.typerTimers.get(userId));
    this.typerTimers.delete(userId);
    if (!this.typers().has(userId)) return;
    this.typers.update((typers) => {
      const next = new Map(typers);
      next.delete(userId);
      return next;
    });
  }

  // Called on every key press in the message box: tells the room once that this user is typing, and
  // that they stopped after a few quiet seconds (or when the message is sent).
  onTyping() {
    const roomId = this.joinedRoomId;
    if (roomId === null) return;
    if (!this.typingSent && this.draft().trim()) {
      this.typingSent = true;
      this.chat.sendTyping(roomId, true);
    }
    if (this.typingIdleTimer) clearTimeout(this.typingIdleTimer);
    this.typingIdleTimer = setTimeout(() => this.stopTyping(), TYPING_IDLE_MS);
  }

  // Tells the room this user has stopped typing.
  private stopTyping() {
    if (this.typingIdleTimer) clearTimeout(this.typingIdleTimer);
    this.typingIdleTimer = null;
    if (this.typingSent && this.joinedRoomId !== null)
      this.chat.sendTyping(this.joinedRoomId, false);
    this.typingSent = false;
  }

  // Sends a chosen PNG: upload it over HTTP first, then send an image message with the returned path.
  async sendImage(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same file again later
    const roomId = this.joinedRoomId;
    if (!file || roomId === null) return;

    if (file.type !== 'image/png') {
      this.chatError.set('Only PNG images can be sent.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.chatError.set('Images must be 2MB or smaller.');
      return;
    }

    this.chatError.set('');
    this.uploading.set(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const { url } = await firstValueFrom(
        this.http.post<{ url: string }>(`${API_URL}/rooms/${roomId}/images`, form),
      );
      await this.chat.sendMessage(roomId, 'image', url);
    } catch (err) {
      this.chatError.set(errorMessage(err, 'Unable to send that image.'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected readonly serverUrl = SERVER_URL;

  // The full address of an image message's picture on the server.
  imageUrl(message: Message) {
    return `${SERVER_URL}${message.content}`;
  }

  // Opens an image full size in the viewer and moves keyboard focus to its Close button.
  openImage(message: Message) {
    this.viewedImage.set(message);
    setTimeout(() => this.viewerClose()?.nativeElement.focus());
  }

  // Closes the image viewer (Close button, clicking outside the image, or Escape).
  closeImage() {
    this.viewedImage.set(null);
  }

  // Sends the typed text. The server echoes it back through messages$, which adds it to the feed.
  async sendMessage() {
    const roomId = this.joinedRoomId;
    const text = this.draft().trim();
    if (roomId === null || !text) return;
    if (text.length > LIMITS.message) {
      this.chatError.set(`Messages can be at most ${LIMITS.message} characters.`);
      return;
    }

    this.chatError.set('');
    this.stopTyping();
    try {
      await this.chat.sendMessage(roomId, 'text', text);
      this.draft.set('');
    } catch (err) {
      this.chatError.set(err instanceof Error ? err.message : 'Unable to send that message.');
    }
  }

  // Whether a message was sent by the logged-in user (shown on the right).
  isMine(message: Message) {
    return message.senderId === this.currentUser()?.id;
  }

  // Chooses which tab of the group information panel is shown.
  setInfoTab(tab: InfoTab) {
    this.infoTab.set(tab);
  }

  // Shows or hides the group information panel.
  toggleDescription() {
    this.showDescription.update((v) => !v);
  }

  // Shows or hides the groups and rooms columns.
  toggleGroups() {
    this.showGroups.update((v) => !v);
  }

  // Logs out and goes back to the login page.
  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/');
  }
}
