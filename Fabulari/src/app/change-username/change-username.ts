import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser } from '../services/auth.service';

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
  protected newUsername = '';

  onSubmit() {
    this.errorMessage.set('');

    if (!this.newUsername.trim()) {
      this.errorMessage.set('Username cannot be empty.');
      return;
    }

    const currentUser = this.auth.currentUser();
    if (!currentUser) {
      this.errorMessage.set('You must be logged in.');
      return;
    }

    this.http.put<CurrentUser>(`http://localhost:3000/api/users/${currentUser.id}`, {
      username: this.newUsername,
    }).subscribe({
      next: (updatedUser) => {
        this.auth.updateCurrentUser(updatedUser);
        this.router.navigateByUrl('/settings');
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Unable to change username.');
      },
    });
  }
}
