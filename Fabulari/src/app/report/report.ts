import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { Group } from '../models';
import { LIMITS } from '../validation';

// Lets a member report another member of one of their groups. The report goes to that group's admins.
@Component({
  selector: 'app-report',
  imports: [FormsModule, RouterLink],
  templateUrl: './report.html',
  styleUrl: './report.css',
})
export class Report {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  protected readonly myGroups = signal<Group[]>([]);
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly limits = LIMITS;

  protected groupId: number | null = null;
  protected username = '';
  protected reason = '';

  // Loads the groups the user belongs to, for the group drop-down.
  ngOnInit() {
    const userId = this.auth.currentUser()?.id;
    this.http.get<Group[]>(`${API_URL}/groups`).subscribe({
      next: (groups) =>
        this.myGroups.set(groups.filter((g) => g.members.some((m) => m.userId === userId))),
      error: () => this.errorMessage.set('Unable to reach the server.'),
    });
  }

  // Checks the form and sends the report.
  onSubmit() {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.groupId || !this.username.trim() || !this.reason.trim()) {
      this.errorMessage.set('Please fill in all fields.');
      return;
    }
    if (this.reason.trim().length > LIMITS.reason) {
      this.errorMessage.set(`The reason can be at most ${LIMITS.reason} characters.`);
      return;
    }

    this.http
      .post(`${API_URL}/reports`, {
        groupId: this.groupId,
        username: this.username,
        reason: this.reason,
      })
      .subscribe({
        next: () => {
          this.successMessage.set(
            `Report against ${this.username.trim()} sent to the group admins.`,
          );
          this.username = '';
          this.reason = '';
        },
        error: (err) => this.errorMessage.set(err.error?.message ?? 'Unable to submit report.'),
      });
  }
}
