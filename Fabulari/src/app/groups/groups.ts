import { Component, inject, signal } from '@angular/core';
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

interface JoinRequest {
  id: number;
  groupId: number;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
}

interface CurrentUser {
  id: number;
  role: string;
}

type GroupStatus = 'admin' | 'member' | 'pending' | 'rejected' | 'none';

@Component({
  selector: 'app-groups',
  imports: [RouterLink],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  private readonly http = inject(HttpClient);

  protected readonly groups = signal<Group[]>([]);
  protected readonly myRequests = signal<JoinRequest[]>([]);
  protected readonly currentUserId = signal<number | null>(null);
  protected readonly errorMessage = signal('');

  ngOnInit() {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      const currentUser: CurrentUser = JSON.parse(stored);
      this.currentUserId.set(currentUser.id);
    }
    this.loadGroups();
    this.loadMyRequests();
  }

  private loadGroups() {
    this.http.get<Group[]>('http://localhost:3000/api/groups').subscribe({
      next: (groups) => this.groups.set(groups),
      error: () => this.errorMessage.set('Unable to reach the server.'),
    });
  }

  private loadMyRequests() {
    this.http.get<JoinRequest[]>('http://localhost:3000/api/join-requests/mine').subscribe({
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
    this.http.post<JoinRequest>(`http://localhost:3000/api/groups/${group.id}/join-requests`, {}).subscribe({
      next: () => this.loadMyRequests(),
      error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to request to join that group.'),
    });
  }
}
