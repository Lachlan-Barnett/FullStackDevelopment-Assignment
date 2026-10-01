import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser } from '../services/auth.service';
import { API_URL } from '../api.config';
import { LIMITS, usernameError } from '../validation';

// Changes the logged-in user's username. Usernames are unique, so the server may say it is taken.
@Component({
  selector: 'app-change-username',
  imports: [FormsModule, RouterLink],
  templateUrl: './change-username.html',
  styleUrl: './change-username.css',
})
export class ChangeUsername {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly errorMessage = signal('');
  protected readonly limits = LIMITS;
  protected newUsername = '';

  // Checks the new name, saves it, updates the logged-in user and goes back to Settings.
  onSubmit() {
    const problem = usernameError(this.newUsername);
    this.errorMessage.set(problem);
    if (problem) return;

    const currentUser = this.auth.currentUser();
    if (!currentUser) {
      this.errorMessage.set('You must be logged in.');
      return;
    }

    this.http
      .put<CurrentUser>(`${API_URL}/users/${currentUser.id}`, {
        username: this.newUsername.trim(),
      })
      .subscribe({
        next: (updatedUser) => {
          this.auth.updateCurrentUser({ username: updatedUser.username });
          this.router.navigateByUrl('/settings');
        },
        error: (err) => {
          this.errorMessage.set(err.error?.message || 'Unable to change username.');
        },
      });
  }
}
