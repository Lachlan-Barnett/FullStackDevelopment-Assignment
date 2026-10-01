import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { API_URL } from '../api.config';
import { AuthService } from '../services/auth.service';
import { ChatSocketService } from '../services/chat-socket.service';
import {
  AuditLogEntry,
  AuditLogPage,
  Group,
  GroupDeleteRequest,
  GroupRequest,
  RemovedUser,
  SystemBanRequest,
  User,
} from '../models';
import { debounceTime, filter } from 'rxjs';

// How many audit log entries are fetched at a time ("Load more" fetches the next page).
const AUDIT_PAGE_SIZE = 50;

// The super admin's home page: the requests waiting for their decision (new groups, group deletions,
// user removals), every group and user, removed users, and the audit log.
@Component({
  selector: 'app-super-admin-dashboard',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './super-admin-dashboard.html',
  styleUrl: './super-admin-dashboard.css',
})
export class SuperAdminDashboard {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly chat = inject(ChatSocketService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly groups = signal<Group[]>([]);
  protected readonly users = signal<User[]>([]);
  // Accounts permanently removed from Fabulari, which no longer appear in the users list.
  protected readonly removedUsers = signal<RemovedUser[]>([]);
  protected readonly errorMessage = signal('');

  // Search boxes for the All Groups and All Users lists, so they stay usable with many groups and users.
  protected readonly groupSearch = signal('');
  protected readonly userSearch = signal('');
  protected readonly filteredGroups = computed(() => {
    const term = this.groupSearch().trim().toLowerCase();
    return term ? this.groups().filter((g) => g.name.toLowerCase().includes(term)) : this.groups();
  });
  protected readonly filteredUsers = computed(() => {
    const term = this.userSearch().trim().toLowerCase();
    return term
      ? this.users().filter(
          (u) => u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
        )
      : this.users();
  });

  // Audit log with a type filter ("" = all types) and newest/oldest ordering.
  protected readonly auditLog = signal<AuditLogEntry[]>([]);
  protected readonly auditTypes = signal<string[]>([]);
  protected readonly auditType = signal('');
  protected readonly auditOrder = signal<'newest' | 'oldest'>('newest');
  // How many entries match the filter in total, so "Load more" is only offered while some are left.
  protected readonly auditTotal = signal(0);
  protected readonly auditLoading = signal(false);

  protected readonly groupRequests = signal<GroupRequest[]>([]);
  protected readonly deleteRequests = signal<GroupDeleteRequest[]>([]);
  protected deleteRejectReasons: Record<number, string> = {};
  protected readonly removalRequests = signal<SystemBanRequest[]>([]);
  protected removalRejectReasons: Record<number, string> = {};
  protected rejectReasons: Record<number, string> = {};

  // Loads every panel. The server sends a "super-admin" refresh after every audited action, so the page
  // reloads itself (at most a few times a second) and new requests appear without pressing anything.
  ngOnInit() {
    this.loadAll();
    this.chat.refresh$
      .pipe(
        filter((event) => event.scope === 'super-admin'),
        debounceTime(300),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.loadAll(true));
  }

  // Loads (or reloads) every panel. A reload keeps however many audit entries are already shown.
  private loadAll(reload = false) {
    this.loadGroups();
    this.loadUsers();
    this.loadGroupRequests();
    this.loadDeleteRequests();
    this.loadRemovalRequests();
    this.loadRemovedUsers();
    this.loadAuditLog(reload ? Math.max(AUDIT_PAGE_SIZE, this.auditLog().length) : AUDIT_PAGE_SIZE);
  }

  // Loads the first page of the audit log with the current filter and order.
  loadAuditLog(limit = AUDIT_PAGE_SIZE) {
    this.fetchAuditLog(0, limit, (entries) => this.auditLog.set(entries));
  }

  // Adds the next page of entries to the bottom of the log.
  loadMoreAudit() {
    this.fetchAuditLog(this.auditLog().length, AUDIT_PAGE_SIZE, (entries) =>
      this.auditLog.update((shown) => [...shown, ...entries]),
    );
  }

  // Fetches one page of the audit log and hands the entries to `use`.
  private fetchAuditLog(skip: number, limit: number, use: (entries: AuditLogEntry[]) => void) {
    const params: Record<string, string | number> = { order: this.auditOrder(), skip, limit };
    if (this.auditType()) params['type'] = this.auditType();
    this.auditLoading.set(true);
    this.http.get<AuditLogPage>(`${API_URL}/admin/audit-log`, { params }).subscribe({
      next: ({ types, entries, total }) => {
        this.auditTypes.set(types);
        this.auditTotal.set(total);
        use(entries);
        this.auditLoading.set(false);
      },
      error: () => this.auditLoading.set(false),
    });
  }

  // Shows only one type of audit entry ('' for every type).
  setAuditType(type: string) {
    this.auditType.set(type);
    this.loadAuditLog();
  }

  // Switches the audit log between newest first and oldest first.
  toggleAuditOrder() {
    this.auditOrder.update((o) => (o === 'newest' ? 'oldest' : 'newest'));
    this.loadAuditLog();
  }

  // Requests from group admins to remove a user from Fabulari.
  private loadRemovalRequests() {
    this.http.get<SystemBanRequest[]>(`${API_URL}/admin/system-ban-requests`).subscribe({
      next: (requests) => this.removalRequests.set(requests),
    });
  }

  // Approving deletes the account for good and blocks the email from signing up again.
  actionRemovalRequest(request: SystemBanRequest, approve: boolean) {
    if (
      approve &&
      !confirm(
        `Permanently remove ${request.username} (${request.email}) from Fabulari? Their email can never be used again.`,
      )
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
          this.loadAuditLog();
          if (approve) {
            this.loadUsers();
            this.loadRemovedUsers();
            this.loadGroups();
          }
        },
        error: (err) =>
          this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }

  // Accounts already removed from Fabulari.
  private loadRemovedUsers() {
    this.http.get<RemovedUser[]>(`${API_URL}/admin/removed-users`).subscribe({
      next: (removed) => this.removedUsers.set(removed),
    });
  }

  // Requests from group admins to delete their group.
  private loadDeleteRequests() {
    this.http.get<GroupDeleteRequest[]>(`${API_URL}/admin/group-delete-requests`).subscribe({
      next: (requests) => this.deleteRequests.set(requests),
    });
  }

  // Deletes the group (after confirming) or keeps it.
  actionDeleteRequest(request: GroupDeleteRequest, approve: boolean) {
    if (
      approve &&
      !confirm(
        `Delete "${request.groupName}" and all of its rooms and messages? This can't be undone.`,
      )
    ) {
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
          this.loadAuditLog();
          if (approve) this.loadGroups();
        },
        error: (err) =>
          this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }

  // Logs out and goes back to the login page.
  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/');
  }

  // Requests from users for a new group.
  private loadGroupRequests() {
    this.http.get<GroupRequest[]>(`${API_URL}/admin/group-requests`).subscribe({
      next: (requests) => this.groupRequests.set(requests),
    });
  }

  // Every group.
  private loadGroups() {
    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => this.groups.set(groups),
    });
  }

  // Every account (only the super admin can see this list).
  private loadUsers() {
    this.http.get<User[]>(`${API_URL}/users`).subscribe({
      next: (users) => this.users.set(users),
    });
  }

  // A user's name for display, or "User #id" if the account is unknown.
  usernameFor(userId: number) {
    return this.users().find((u) => u.id === userId)?.username ?? `User #${userId}`;
  }

  // How many admins a group has, shown in the All Groups list.
  adminCountFor(group: Group) {
    return group.members.filter((m) => m.role === 'admin').length;
  }

  // Approves a group request (creating the group, with the requester as its admin) or rejects it.
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
          this.loadAuditLog();
          if (approve) this.loadGroups();
        },
        error: (err) =>
          this.errorMessage.set(err.error?.message ?? 'Unable to action that request.'),
      });
  }
}
