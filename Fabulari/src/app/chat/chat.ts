import { Component, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { Group, GroupMemberDetails, Room, THEME_TINTS } from '../models';

type InfoTab = 'info' | 'age' | 'colour' | 'members';

@Component({
  selector: 'app-chat',
  imports: [RouterLink],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})

export class Chat {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly currentUser = this.auth.currentUser;
  protected readonly myGroups = signal<Group[]>([]);
  protected readonly rooms = signal<Room[]>([]);
  protected readonly members = signal<GroupMemberDetails[]>([]);

  protected readonly selectedGroupId = signal<number | null>(null);
  protected readonly selectedRoomId = signal<number | null>(null);
  protected readonly showDescription = signal(false);
  protected readonly showGroups = signal(true);
  protected readonly infoTab = signal<InfoTab>('info');

  protected readonly selectedGroup = computed(() =>
    this.myGroups().find((g) => g.id === this.selectedGroupId()) ?? null,
  );

  protected readonly isGroupAdmin = computed(() => {
    const user = this.currentUser();
    const group = this.selectedGroup();
    if (!user || !group) return false;
    return group.members.some((m) => m.userId === user.id && m.role === 'admin');
  });

  protected readonly isSuperAdmin = computed(() => this.currentUser()?.role === 'superadmin');

  protected readonly themeTint = computed(() => {
    const theme = this.selectedGroup()?.colourTheme;
    return theme ? THEME_TINTS[theme] : null;
  });

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
        this.selectedRoomId.set(rooms.length ? rooms[0].id : null);
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

  selectGroup(id: number) {
    this.selectedGroupId.set(id);
    this.members.set([]);
    this.loadRooms(id);
    this.loadMembers(id);
  }

  selectRoom(id: number) {
    this.selectedRoomId.set(id);
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
