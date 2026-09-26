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

interface CurrentUser {
  id: number;
  role: string;
}

@Component({
  selector: 'app-groups',
  imports: [RouterLink],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
})
export class Groups {
  private readonly http = inject(HttpClient);

  protected readonly groups = signal<Group[]>([]);
  protected readonly currentUserId = signal<number | null>(null);
  protected readonly errorMessage = signal('');

  ngOnInit() {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      const currentUser: CurrentUser = JSON.parse(stored);
      this.currentUserId.set(currentUser.id);
    }
    this.loadGroups();
  }

  private loadGroups() {
    this.http.get<Group[]>('http://localhost:3000/api/groups').subscribe({
      next: (groups) => this.groups.set(groups),
      error: () => this.errorMessage.set('Unable to reach the server.'),
    });
  }

  hasApplied(group: Group) {
    const userId = this.currentUserId();
    return userId != null && group.members.some((m) => m.userId === userId);
  }

  isAdmin(group: Group) {
    const userId = this.currentUserId();
    return userId != null && group.members.some((m) => m.userId === userId && m.role === 'admin');
  }

  apply(group: Group) {
    const userId = this.currentUserId();
    if (userId == null || this.hasApplied(group)) return;

    this.http.post<Group>(`http://localhost:3000/api/groups/${group.id}/join`, {}).subscribe({
      next: () => this.loadGroups(),
      error: () => this.errorMessage.set('Unable to join that group.'),
    });
  }
}
