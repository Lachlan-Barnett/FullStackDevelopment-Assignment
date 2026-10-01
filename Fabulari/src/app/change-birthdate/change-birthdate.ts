import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { API_URL } from '../api.config';
import { birthdateError, today } from '../validation';

// What the server sends back: the updated user, plus any groups the new birthdate is too young for.
type BirthdateResponse = CurrentUser & {
  removedFrom: { id: number; name: string; ageLimit: number }[];
};

// Changes the logged-in user's date of birth, which group age limits are checked against.
@Component({
  selector: 'app-change-birthdate',
  imports: [FormsModule, RouterLink],
  templateUrl: './change-birthdate.html',
  styleUrl: './change-birthdate.css',
})
export class ChangeBirthdate {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);

  protected readonly errorMessage = signal('');
  protected readonly maxBirthdate = today();
  protected newBirthdate = '';

  // Checks the date, saves it and goes back to Settings. If the new age is under a group's age limit,
  // the server removes the user from that group (like an admin raising the limit) and they are told.
  onSubmit() {
    const problem = birthdateError(this.newBirthdate);
    this.errorMessage.set(problem);
    if (problem) return;

    const currentUser = this.auth.currentUser();
    if (!currentUser) {
      this.errorMessage.set('You must be logged in.');
      return;
    }

    this.http
      .put<BirthdateResponse>(`${API_URL}/users/${currentUser.id}`, {
        birthdate: this.newBirthdate,
      })
      .subscribe({
        next: ({ removedFrom, birthdate }) => {
          this.auth.updateCurrentUser({ birthdate });
          for (const group of removedFrom ?? []) {
            this.notifications.show(
              `You were removed from "${group.name}" because its age limit is ${group.ageLimit}.`,
            );
          }
          this.router.navigateByUrl('/settings');
        },
        error: (err) => {
          this.errorMessage.set(err.error?.message || 'Unable to change birthdate.');
        },
      });
  }
}
