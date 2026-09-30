import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ChatSocketService } from '../services/chat-socket.service';
import { API_URL, SERVER_URL } from '../api.config';
import { Group, GroupMemberDetails, Message, PresentUser, Room, RoomRequest, THEME_TINTS } from '../models';

// Client limits for image messages: PNG only, at most 2MB. The server checks these again.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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

@Component({
  selector: 'app-chat',
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
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

  // "Request room" form: members propose a room for the selected group; an admin approves or rejects it.
  protected readonly showRoomRequest = signal(false);
  protected readonly roomRequestName = signal('');
  protected readonly roomRequestDescription = signal('');
  protected readonly roomRequestError = signal('');
  protected readonly roomRequestSuccess = signal('');
  protected readonly roomRequestSending = signal(false);
  protected readonly draft = signal('');

  private readonly messageList = viewChild<ElementRef<HTMLElement>>('messageList');
  private joinedRoomId: number | null = null;
  private noticeCount = 0;

  protected readonly selectedGroup = computed(() =>
    this.myGroups().find((g) => g.id === this.selectedGroupId()) ?? null,
  );

  protected readonly selectedRoom = computed(() =>
    this.rooms().find((r) => r.id === this.selectedRoomId()) ?? null,
  );

  protected readonly isGroupAdmin = computed(() => {
    const user = this.currentUser();
    const group = this.selectedGroup();
    if (!user || !group) return false;
    return group.members.some((m) => m.userId === user.id && m.role === 'admin');
  });

  // Ids of the selected group's admins, for the "Admin" badge on their messages.
  protected readonly adminIds = computed(
    () => new Set(this.selectedGroup()?.members.filter((m) => m.role === 'admin').map((m) => m.userId) ?? []),
  );

  protected readonly themeTint = computed(() => {
    const theme = this.selectedGroup()?.colourTheme;
    return theme ? THEME_TINTS[theme] : null;
  });

  constructor() {
    this.chat.messages$.pipe(takeUntilDestroyed()).subscribe((message) => {
      if (message.roomId !== this.joinedRoomId) return;
      this.feed.update((items) => [...items, { kind: 'message', key: `m${message.id}`, message }]);
    });

    this.chat.presence$.pipe(takeUntilDestroyed()).subscribe(({ roomId, users }) => {
      if (roomId === this.joinedRoomId) this.present.set(users);
    });

    this.chat.activity$.pipe(takeUntilDestroyed()).subscribe(({ type, roomId, user }) => {
      if (roomId !== this.joinedRoomId) return;
      this.addNotice(`${user.username} ${type === 'joined' ? 'joined' : 'left'} the room`);
    });

    this.chat.errors$.pipe(takeUntilDestroyed()).subscribe((message) => this.chatError.set(message));

    // Keep the newest message in view.
    afterRenderEffect(() => {
      this.feed();
      const list = this.messageList()?.nativeElement;
      if (list) list.scrollTop = list.scrollHeight;
    });

    this.destroyRef.onDestroy(() => this.leaveCurrentRoom());
  }

  ngOnInit() {
    this.loadGroups();
  }

  private loadGroups() {
    const user = this.currentUser();
    if (!user) return;

    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => {
        const mine = groups.filter((g) => g.members.some((m) => m.userId === user.id));
        this.myGroups.set(mine);
        if (mine.length) {
          this.selectGroup(mine[0].id);
        }
      },
    });
  }

  private loadRooms(groupId: number) {
    this.http.get<Room[]>(`${API_URL}/groups/${groupId}/rooms`).subscribe({
      next: (rooms) => {
        this.rooms.set(rooms);
        this.selectRoom(rooms.length ? rooms[0].id : null);
      },
    });
  }

  private loadMembers(groupId: number) {
    this.http.get<GroupMemberDetails[]>(`${API_URL}/groups/${groupId}/members`).subscribe({
      // Admins first, then alphabetical, so it's easy to see who runs the group.
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

  toggleRoomRequest() {
    this.showRoomRequest.update((v) => !v);
    this.roomRequestError.set('');
    this.roomRequestSuccess.set('');
  }

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

    this.roomRequestSending.set(true);
    this.http
      .post<RoomRequest>(`${API_URL}/groups/${group.id}/room-requests`, {
        name,
        description: this.roomRequestDescription().trim(),
      })
      .subscribe({
        next: (request) => {
          this.roomRequestSending.set(false);
          this.roomRequestSuccess.set(`Request for "${request.name}" sent to the ${group.name} admins.`);
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

  selectRoom(id: number | null) {
    if (id === this.joinedRoomId && id !== null) return;
    this.selectedRoomId.set(id);
    this.leaveCurrentRoom();
    if (id !== null) this.joinRoom(id);
  }

  private async joinRoom(roomId: number) {
    this.joinedRoomId = roomId;
    this.chatError.set('');
    try {
      const { history, present } = await this.chat.joinRoom(roomId);
      if (this.joinedRoomId !== roomId) return; // the user already moved to another room
      this.feed.set(history.map((message) => ({ kind: 'message', key: `m${message.id}`, message })));
      this.present.set(present);
    } catch (err) {
      if (this.joinedRoomId === roomId) {
        this.chatError.set(err instanceof Error ? err.message : 'Unable to join this room.');
      }
    }
  }

  private leaveCurrentRoom() {
    if (this.joinedRoomId !== null) this.chat.leaveRoom(this.joinedRoomId);
    this.joinedRoomId = null;
    this.feed.set([]);
    this.present.set([]);
  }

  private addNotice(text: string) {
    this.feed.update((items) => [...items, { kind: 'notice', key: `n${++this.noticeCount}`, text }]);
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
      const { url } = await firstValueFrom(this.http.post<{ url: string }>(`${API_URL}/rooms/${roomId}/images`, form));
      await this.chat.sendMessage(roomId, 'image', url);
    } catch (err) {
      this.chatError.set(errorMessage(err, 'Unable to send that image.'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected readonly serverUrl = SERVER_URL;

  imageUrl(message: Message) {
    return `${SERVER_URL}${message.content}`;
  }

  async sendMessage() {
    const roomId = this.joinedRoomId;
    const text = this.draft().trim();
    if (roomId === null || !text) return;

    this.chatError.set('');
    try {
      // The server echoes the message back through messages$, which adds it to the feed.
      await this.chat.sendMessage(roomId, 'text', text);
      this.draft.set('');
    } catch (err) {
      this.chatError.set(err instanceof Error ? err.message : 'Unable to send that message.');
    }
  }

  isMine(message: Message) {
    return message.senderId === this.currentUser()?.id;
  }

  setInfoTab(tab: InfoTab) {
    this.infoTab.set(tab);
  }

  toggleDescription() {
    this.showDescription.update((v) => !v);
  }

  toggleGroups() {
    this.showGroups.update((v) => !v);
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/');
  }
}
