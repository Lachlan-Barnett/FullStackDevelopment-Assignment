import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ChatSocketService } from '../services/chat-socket.service';
import { API_URL } from '../api.config';
import { COLOUR_THEMES, ColourTheme, Group, GroupRequest, JoinRequest } from '../models';
import { ageLimitError, LIMITS } from '../validation';

type GroupStatus = 'admin' | 'member' | 'banned' | 'pending' | 'rejected' | 'none';

// Every group, with the user's state in each (Apply, Pending, Member, Admin or Banned), a search box,
// the Leave button, and the form to ask the super admin for a new group.
@Component({
  selector: 'app-groups',
  imports: [RouterLink, FormsModule],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly chat = inject(ChatSocketService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly groups = signal<Group[]>([]);
  protected readonly myRequests = signal<JoinRequest[]>([]);
  protected readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? null);
  protected readonly errorMessage = signal('');
  protected readonly limits = LIMITS;

  // Filters the list by name or description, so the page stays usable with many groups.
  protected readonly search = signal('');
  protected readonly filteredGroups = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.groups();
    return this.groups().filter(
      (g) => g.name.toLowerCase().includes(term) || g.description.toLowerCase().includes(term),
    );
  });

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

  // Opens or closes the "Request a new group" form.
  toggleRequestForm() {
    this.showRequestForm.update((v) => !v);
    this.requestError.set('');
    this.requestSuccess.set('');
  }

  // Checks the form and sends the new group request to the super admin.
  submitGroupRequest() {
    const name = this.newGroupName().trim();
    this.requestError.set('');
    this.requestSuccess.set('');

    if (!name) {
      this.requestError.set('Please give the group a name.');
      return;
    }
    if (name.length > LIMITS.name) {
      this.requestError.set(`Group names can be at most ${LIMITS.name} characters.`);
      return;
    }
    if (this.newGroupDescription().trim().length > LIMITS.description) {
      this.requestError.set(`Descriptions can be at most ${LIMITS.description} characters.`);
      return;
    }
    const ageProblem = ageLimitError(this.newGroupAgeLimit());
    if (ageProblem) {
      this.requestError.set(ageProblem);
      return;
    }

    this.requestSending.set(true);
    this.http
      .post<GroupRequest>(`${API_URL}/group-requests`, {
        name,
        description: this.newGroupDescription().trim(),
        ageLimit: Number(this.newGroupAgeLimit()),
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

  // Loads the groups and the user's join requests, and reloads them whenever the server says they changed
  // (e.g. a join request was approved, or the user was banned from a group).
  ngOnInit() {
    this.loadGroups();
    this.loadMyRequests();
    this.chat.refresh$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ scope }) => {
      if (scope === 'groups' || scope === 'requests') {
        this.loadGroups();
        this.loadMyRequests();
      }
    });
  }

  // Every group in Fabulari.
  private loadGroups() {
    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) => this.groups.set(groups),
      error: () => this.errorMessage.set('Unable to reach the server.'),
    });
  }

  // The user's join requests, which decide the Pending and "Request rejected" states.
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

  // The user's state in a group, which decides the badge or button shown.
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

  // Asks to join a group. Users under its age limit are rejected straight away by the server.
  apply(group: Group) {
    const status = this.status(group);
    if (status !== 'none' && status !== 'rejected') return;

    this.errorMessage.set('');
    this.http.post<JoinRequest>(`${API_URL}/groups/${group.id}/join-requests`, {}).subscribe({
      next: () => this.loadMyRequests(),
      error: (err) =>
        this.errorMessage.set(err.error?.message ?? 'Unable to request to join that group.'),
    });
  }
}
