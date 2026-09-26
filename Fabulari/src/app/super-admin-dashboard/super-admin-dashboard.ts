import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';

interface Group {
  id: number;
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: string;
  members: { userId: number; role: string }[];
}

interface AppUser {
  id: number;
  username: string;
  email: string;
  role: string;
}

interface GroupRequest {
  id: number;
  requestedBy: number;
  requesterName: string | null;
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: string;
  createdAt: string;
}

interface AuditLogEntry {
  type: string;
  details: string;
  timestamp: string;
}

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private readonly http = inject(HttpClient);

  protected readonly groups = signal<Group[]>([]);
  protected readonly users = signal<AppUser[]>([]);
  protected readonly errorMessage = signal('');

  protected readonly auditLog = signal<AuditLogEntry[]>([
    { type: 'GROUP_CREATED', details: 'Demo Group was created', timestamp: '2026-08-01' },
    { type: 'ROOM_APPROVED', details: 'General channel approved for Demo Group', timestamp: '2026-08-01' },
  ]);

  protected readonly groupRequests = signal<GroupRequest[]>([]);
  protected rejectReasons: Record<number, string> = {};

  ngOnInit() {
    this.loadGroups();
    this.loadUsers();
    this.loadGroupRequests();
  }

  private loadGroupRequests() {
    this.http.get<GroupRequest[]>('http://localhost:3000/api/admin/group-requests').subscribe({
      next: (requests) => this.groupRequests.set(requests),
    });
  }

  private loadGroups() {
    this.http.get<Group[]>('http://localhost:3000/api/groups').subscribe({
      next: (groups) => this.groups.set(groups),
    });
  }

  private loadUsers() {
    this.http.get<AppUser[]>('http://localhost:3000/api/users').subscribe({
      next: (users) => this.users.set(users),
    });
  }

  usernameFor(userId: number) {
    return this.users().find((u) => u.id === userId)?.username ?? `User #${userId}`;
  }

  adminCountFor(group: Group) {
    return group.members.filter((m) => m.role === 'admin').length;
  }

  actionGroupRequest(request: GroupRequest, approve: boolean) {
    this.errorMessage.set('');
    this.http
      .put(`http://localhost:3000/api/admin/group-requests/${request.id}`, {
        approve,
        reason: this.rejectReasons[request.id] ?? '',
      })
      .subscribe({
        next: () => {
          delete this.rejectReasons[request.id];
          this.loadGroupRequests();
          if (approve) this.loadGroups();
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }
}
