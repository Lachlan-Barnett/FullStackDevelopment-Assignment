import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { API_URL } from '../api.config';
import { AuthService } from '../services/auth.service';
import { AuditLogEntry, Group, GroupDeleteRequest, GroupRequest, SystemBanRequest, User } from '../models';

@Component({
  selector: 'app-super-admin-dashboard',
  imports: [FormsModule, RouterLink],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly groups = signal<Group[]>([]);
  protected readonly users = signal<User[]>([]);
  protected readonly errorMessage = signal('');

  protected readonly auditLog = signal<AuditLogEntry[]>([]);

  protected readonly groupRequests = signal<GroupRequest[]>([]);
  protected readonly deleteRequests = signal<GroupDeleteRequest[]>([]);
  protected deleteRejectReasons: Record<number, string> = {};
  protected readonly removalRequests = signal<SystemBanRequest[]>([]);
  protected removalRejectReasons: Record<number, string> = {};
  protected rejectReasons: Record<number, string> = {};

  ngOnInit() {
    this.loadGroups();
    this.loadUsers();
    this.loadGroupRequests();
    this.loadDeleteRequests();
    this.loadRemovalRequests();
  }

  private loadRemovalRequests() {
    this.http.get<SystemBanRequest[]>(`${API_URL}/admin/system-ban-requests`).subscribe({
      next: (requests) => this.removalRequests.set(requests),
    });
  }

  // Approving deletes the account for good and blocks the email from signing up again.
  actionRemovalRequest(request: SystemBanRequest, approve: boolean) {
    if (
      approve &&
      !confirm(`Permanently remove ${request.username} (${request.email}) from Fabulari? Their email can never be used again.`)
    ) {
      return;
    }
    this.errorMessage.set('');
    this.http
      .put(`${API_URL}/admin/system-ban-requests/${request.id}`, {
        approve,
        reason: this.removalRejectReasons[request.id] ?? '',
      })
      .subscribe({
        next: () => {
          delete this.removalRejectReasons[request.id];
          this.loadRemovalRequests();
          if (approve) {
            this.loadUsers();
            this.loadGroups();
          }
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }

  private loadDeleteRequests() {
    this.http.get<GroupDeleteRequest[]>(`${API_URL}/admin/group-delete-requests`).subscribe({
      next: (requests) => this.deleteRequests.set(requests),
    });
  }

  actionDeleteRequest(request: GroupDeleteRequest, approve: boolean) {
    if (approve && !confirm(`Delete "${request.groupName}" and all of its rooms and messages? This can't be undone.`)) {
      return;
    }
    this.errorMessage.set('');
    this.http
      .put(`${API_URL}/admin/group-delete-requests/${request.id}`, {
        approve,
        reason: this.deleteRejectReasons[request.id] ?? '',
      })
      .subscribe({
        next: () => {
          delete this.deleteRejectReasons[request.id];
          this.loadDeleteRequests();
          if (approve) this.loadGroups();
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/');
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
