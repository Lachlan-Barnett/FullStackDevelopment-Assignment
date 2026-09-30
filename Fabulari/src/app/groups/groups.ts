import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { COLOUR_THEMES, ColourTheme, Group, GroupRequest, JoinRequest } from '../models';

type GroupStatus = 'admin' | 'member' | 'banned' | 'pending' | 'rejected' | 'none';

@Component({
  selector: 'app-groups',
  imports: [RouterLink, FormsModule],
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

  // "Request a new group" form. The super admin creates the group if they approve it,
  // and the requester becomes its first admin.
  protected readonly colourThemes = COLOUR_THEMES;
  protected readonly showRequestForm = signal(false);
  protected readonly newGroupName = signal('');
  protected readonly newGroupDescription = signal('');
  protected readonly newGroupAgeLimit = signal(0);
  protected readonly newGroupColour = signal<ColourTheme>('Blue');
  protected readonly requestError = signal('');
  protected readonly requestSuccess = signal('');
  protected readonly requestSending = signal(false);

  toggleRequestForm() {
    this.showRequestForm.update((v) => !v);
    this.requestError.set('');
    this.requestSuccess.set('');
  }

  submitGroupRequest() {
    const name = this.newGroupName().trim();
    const ageLimit = Number(this.newGroupAgeLimit());
    this.requestError.set('');
    this.requestSuccess.set('');

    if (!name) {
      this.requestError.set('Please give the group a name.');
      return;
    }
    if (!Number.isInteger(ageLimit) || ageLimit < 0 || ageLimit > 120) {
      this.requestError.set('Age limit must be a whole number from 0 to 120.');
      return;
    }

    this.requestSending.set(true);
    this.http
      .post<GroupRequest>(`${API_URL}/group-requests`, {
        name,
        description: this.newGroupDescription().trim(),
        ageLimit,
        colourTheme: this.newGroupColour(),
      })
      .subscribe({
        next: (request) => {
          this.requestSending.set(false);
          this.requestSuccess.set(`Request for "${request.name}" sent to the super admin.`);
          this.newGroupName.set('');
          this.newGroupDescription.set('');
          this.newGroupAgeLimit.set(0);
          this.newGroupColour.set('Blue');
        },
        error: (err) => {
          this.requestSending.set(false);
          this.requestError.set(err.error?.message ?? 'Unable to send that request.');
        },
      });
  }

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
    if (group.isBanned) return 'banned';

    const request = this.latestRequest(group);
    if (request?.status === 'pending') return 'pending';
    if (request?.status === 'rejected') return 'rejected';
    return 'none';
  }

  // Leaving is immediate; the server refuses if you are the group's only admin.
  leave(group: Group) {
    if (!confirm(`Leave "${group.name}"? You'll need to ask to join again to come back.`)) return;

    this.errorMessage.set('');
    this.http.delete(`${API_URL}/groups/${group.id}/membership`).subscribe({
      next: () => this.loadGroups(),
      error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to leave that group.'),
    });
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
