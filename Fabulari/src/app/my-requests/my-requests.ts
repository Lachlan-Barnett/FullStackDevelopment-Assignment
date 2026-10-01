import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { API_URL } from '../api.config';
import { ChatSocketService } from '../services/chat-socket.service';
import { Group, GroupRequest, JoinRequest, RequestStatus, RoomRequest } from '../models';

// One row on the page, whatever kind of request it came from.
interface RequestRow {
  key: string;
  kind: 'New group' | 'New room' | 'Join group';
  title: string;
  status: RequestStatus;
  rejectionReason: string | null;
  createdAt: string;
}

// Shows the user's pending and rejected requests. Approved ones aren't listed:
// they simply show up as the new group, room or membership.
@Component({
  selector: 'app-my-requests',
  imports: [RouterLink, DatePipe],
  templateUrl: './my-requests.html',
  styleUrl: './my-requests.css',
})
export class MyRequests {
  private readonly http = inject(HttpClient);
  private readonly chat = inject(ChatSocketService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rows = signal<RequestRow[]>([]);
  protected readonly loaded = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly pending = computed(() => this.rows().filter((r) => r.status === 'pending'));
  protected readonly rejected = computed(() => this.rows().filter((r) => r.status === 'rejected'));

  // Loads the requests, and reloads them whenever the server says one was approved or rejected.
  ngOnInit() {
    this.load();
    this.chat.refresh$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ scope }) => {
      if (scope === 'requests' || scope === 'groups') this.load();
    });
  }

  // Fetches the user's group, room and join requests (and group names) and turns them into rows.
  private load() {
    forkJoin({
      groups: this.http.get<Group[]>(`${API_URL}/groups`),
      groupRequests: this.http.get<GroupRequest[]>(`${API_URL}/group-requests/mine`),
      roomRequests: this.http.get<RoomRequest[]>(`${API_URL}/room-requests/mine`),
      joinRequests: this.http.get<JoinRequest[]>(`${API_URL}/join-requests/mine`),
    }).subscribe({
      next: ({ groups, groupRequests, roomRequests, joinRequests }) => {
        const groupName = (id: number) =>
          groups.find((g) => g.id === id)?.name ?? 'a deleted group';
        const rows: RequestRow[] = [
          ...groupRequests.map((r) => ({
            key: `g${r.id}`,
            kind: 'New group' as const,
            title: r.name,
            status: r.status,
            rejectionReason: r.rejectionReason,
            createdAt: r.createdAt,
          })),
          ...roomRequests.map((r) => ({
            key: `r${r.id}`,
            kind: 'New room' as const,
            title: `${r.name} in ${groupName(r.groupId)}`,
            status: r.status,
            rejectionReason: r.rejectionReason,
            createdAt: r.createdAt,
          })),
          ...joinRequests.map((r) => ({
            key: `j${r.id}`,
            kind: 'Join group' as const,
            title: groupName(r.groupId),
            status: r.status,
            rejectionReason: r.rejectionReason,
            createdAt: r.createdAt,
          })),
        ];
        // Newest first.
        this.rows.set(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        this.loaded.set(true);
      },
      error: () => {
        this.errorMessage.set('Unable to load your requests.');
        this.loaded.set(true);
      },
    });
  }
}
