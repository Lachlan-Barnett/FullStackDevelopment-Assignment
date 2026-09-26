import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { API_URL } from '../api.config';
import { AuditLogEntry, Group, GroupRequest, User } from '../models';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private readonly http = inject(HttpClient);

  protected readonly groups = signal<Group[]>([]);
  protected readonly users = signal<User[]>([]);
  protected readonly errorMessage = signal('');

  protected readonly auditLog = signal<AuditLogEntry[]>([]);

  protected readonly groupRequests = signal<GroupRequest[]>([]);
  protected rejectReasons: Record<number, string> = {};

  ngOnInit() {
    this.loadGroups();
    this.loadUsers();
    this.loadGroupRequests();
  }

  private loadGroupRequests() {
    this.http.get<GroupRequest[]>(`${API_URL}/admin/group-requests`).subscribe({
      next: (requests) => this.groupRequests.set(requests),
    });
  }

  private loadGroups() {
    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => this.groups.set(groups),
    });
  }

  private loadUsers() {
    this.http.get<User[]>(`${API_URL}/users`).subscribe({
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
      .put(`${API_URL}/admin/group-requests/${request.id}`, {
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
