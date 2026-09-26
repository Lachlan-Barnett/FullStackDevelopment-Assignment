import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { Group, JoinRequest } from '../models';

type GroupStatus = 'admin' | 'member' | 'pending' | 'rejected' | 'none';

@Component({
  selector: 'app-groups',
  imports: [RouterLink],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  protected readonly groups = signal<Group[]>([]);
  protected readonly myRequests = signal<JoinRequest[]>([]);
  protected readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  protected readonly errorMessage = signal('');

  ngOnInit() {
    this.loadGroups();
    this.loadMyRequests();
  }

  private loadGroups() {
    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => this.groups.set(groups),
      error: () => this.errorMessage.set('Unable to reach the server.'),
    });
  }

  private loadMyRequests() {
    this.http.get<JoinRequest[]>(`${API_URL}/join-requests/mine`).subscribe({
      next: (requests) => this.myRequests.set(requests),
    });
  }

  // The most recent join request the user made for this group, if any.
  latestRequest(group: Group) {
    return this.myRequests()
      .filter((r) => r.groupId === group.id)
      .reduce<JoinRequest | null>((latest, r) => (!latest || r.id > latest.id ? r : latest), null);
  }

  status(group: Group): GroupStatus {
    const userId = this.currentUserId();
    const membership = group.members.find((m) => m.userId === userId);
    if (membership) return membership.role === 'admin' ? 'admin' : 'member';

    const request = this.latestRequest(group);
    if (request?.status === 'pending') return 'pending';
    if (request?.status === 'rejected') return 'rejected';
    return 'none';
  }

  apply(group: Group) {
    const status = this.status(group);
    if (status !== 'none' && status !== 'rejected') return;

    this.errorMessage.set('');
    this.http.post<JoinRequest>(`${API_URL}/groups/${group.id}/join-requests`, {}).subscribe({
      next: () => this.loadMyRequests(),
      error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to request to join that group.'),
    });
  }
}
