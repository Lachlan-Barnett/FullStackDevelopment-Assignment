import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

interface Member {
  userId: number;
  role: string;
}

interface Group {
  id: number;
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: string;
  members: Member[];
}

interface Room {
  id: number;
  groupId: number;
  name: string;
  description: string;
}

interface RoomRequest {
  id: number;
  requestedBy: number;
  requesterName: string | null;
  name: string;
  description: string;
}

interface AppUser {
  id: number;
  username: string;
  email: string;
}

@Component({
  selector: 'app-group-admin-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './group-admin-dashboard.html',
  styleUrl: './group-admin-dashboard.css',
})
export class GroupAdminDashboard {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  protected readonly group = signal<Group | null>(null);
  protected readonly rooms = signal<Room[]>([]);
  protected readonly users = signal<AppUser[]>([]);
  protected readonly errorMessage = signal('');

  protected readonly roomRequests = signal<RoomRequest[]>([]);
  protected rejectReasons: Record<number, string> = {};

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
    this.loadGroup(groupID);
    this.loadRooms(groupID);
    this.loadRoomRequests(groupID);
    this.http.get<AppUser[]>('http://localhost:3000/api/users').subscribe({
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

  private loadRoomRequests(groupId: number) {
    this.http.get<RoomRequest[]>(`http://localhost:3000/api/groups/${groupId}/room-requests`).subscribe({
      next: (requests) => this.roomRequests.set(requests),
    });
  }

  actionRoomRequest(request: RoomRequest, approve: boolean) {
    const group = this.group();
    if (!group) return;

    const reason = this.rejectReasons[request.id]?.trim() ?? '';
    if (!approve && !reason) {
      this.errorMessage.set(`Enter a reason before rejecting "${request.name}".`);
      return;
    }

    this.errorMessage.set('');
    this.http
      .put(`http://localhost:3000/api/groups/${group.id}/room-requests/${request.id}`, { approve, reason })
      .subscribe({
        next: () => {
          delete this.rejectReasons[request.id];
          this.loadRoomRequests(group.id);
          if (approve) this.loadRooms(group.id);
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }

  isOwnRequest(request: RoomRequest) {
    return request.requestedBy === this.currentUserId();
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

  // The group must always keep one admin, so the last admin can't be demoted.
  isLastAdmin(member: Member) {
    const admins = this.group()?.members.filter((m) => m.role === 'admin') ?? [];
    return member.role === 'admin' && admins.length === 1;
  }

  toggleRole(member: Member) {
    const group = this.group();
    if (!group || this.isLastAdmin(member)) return;

    const newRole = member.role === 'admin' ? 'member' : 'admin';
    const demotingSelf = this.isSelf(member) && newRole === 'member';
    if (demotingSelf && !confirm('Remove your own admin role? You will no longer be able to manage this group.')) {
      return;
    }

    this.errorMessage.set('');
    this.http
      .put<Group>(`http://localhost:3000/api/groups/${group.id}/members/${member.userId}/role`, {
        role: newRole,
      })
      .subscribe({
        next: (updated) => {
          if (demotingSelf) {
            this.router.navigateByUrl('/chat');
          } else {
            this.group.set(updated);
          }
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to update that member.'),
      });
  }
}
