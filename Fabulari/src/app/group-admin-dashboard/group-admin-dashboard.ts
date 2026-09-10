import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-group-admin-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './group-admin-dashboard.html',
  styleUrl: './group-admin-dashboard.css',
})
export class GroupAdminDashboard {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  protected readonly group = signal<Group | null>(null);
  protected readonly rooms = signal<Room[]>([]);
  protected readonly users = signal<AppUser[]>([]);
  protected readonly errorMessage = signal('');

  protected newRoomName = '';
  protected newRoomDescription = '';

  protected editDescription = '';
  protected editAgeLimit = 0;
  protected editColourTheme = '';

  protected readonly members = computed(() => {
    const group = this.group();
    if (!group) return [];
    return group.members.map((m) => ({
      ...m,
      user: this.users().find((u) => u.id === m.userId),
    }));
  });

  ngOnInit() {
    const groupID = Number(this.route.snapshot.paramMap.get('groupId'));
    this.loadGroup(groupId);
    this.loadRooms(groupId);
    this.http.get<AppUser[]>{'http://localhost:3000/api/users'}.subscribe({
      next: (users) => this.users.set(users),
    });
  }

  private loadGroup(groupId: number) {
    this.http.get<Group>(`http://localhost:3000/api/groups/${groupId}`).subscribe({
      next: (group) => {
        this.group.set(group);
        this.editDescription = group.description;
        this.editAgeLimit = group.ageLimit;
        this.editColourTheme = group.colourTheme;
      },
      error: () => this.errorMessage.set('Unable to load this group.'),
    });
  }

  private loadRooms(groupId: number) {
    this.http.get<Room[]>(`http://localhost:3000/api/groups/${groupId}/rooms`).subscribe({
      next: (rooms) => this.rooms.set(rooms),
    });
  }

  saveGroupDetails() {
    const group = this.group();
    if (!group) return;

    this.http
      .put<Group>(`http://localhost:3000/api/groups/${group.id}`, {
        description: this.editDescription,
        ageLimit: this.editAgeLimit,
        colourTheme: this.editColourTheme,
      })
      .subscribe({
        next: (updated) => this.group.set(updated),
        error: () => this.errorMessage.set('Unable to update the group.'),
      });
  }

  createRoom() {
    const group = this.group();
    if (!group || !this.newRoomName.trim()) return;

    this.http
      .post<Room>(`http://localhost:3000/api/groups/${group.id}/rooms`, {
        name: this.newRoomName,
        description: this.newRoomDescription,
      })
      .subscribe({
        next: () => {
          this.newRoomName = '';
          this.newRoomDescription = '';
          this.loadRooms(group.id);
        },
        error: () => this.errorMessage.set('Unable to create that channel.'),
      });
  }

  deleteRoom(room: Room) {
    const group = this.group();
    if (!group) return;

    this.http.delete(`http://localhost:3000/api/groups/${group.id}/rooms/${room.id}`).subscribe({
      next: () => this.loadRooms(group.id),
      error: () => this.errorMessage.set('Unable to delete that channel.'),
    });
  }

  isSelf(member: Member) {
    return member.userId === this.currentUserId();
  }

  toggleRole(member: Member) {
    const group = this.group();
    if (!group || this.isSelf(member)) return;

    const newRole = member.role === 'admin' ? 'member' : 'admin';
    this.http
      .put<Group>(`http://localhost:3000/api/groups/${group.id}/members/${member.userId}/role`, {
        role: newRole,
        actingUserId: this.currentUserId(),
      })
      .subscribe({
        next: (updated) => this.group.set(updated),
        error: () => this.errorMessage.set('Unable to update that member.'),
      });
  }
}
