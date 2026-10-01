import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { LIMITS } from '../validation';

// Changes the logged-in user's password: the current password once, then the new password twice.
@Component({
  selector: 'app-change-password',
  imports: [FormsModule, RouterLink],
  templateUrl: './change-password.html',
  styleUrl: './change-password.css',
})
export class ChangePassword {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly showCurrentPassword = signal(false);
  protected readonly showNewPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly errorMessage = signal('');
  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';

  // Each password field has its own "Show password" checkbox.
  toggleCurrentPassword() {
    this.showCurrentPassword.update((v) => !v);
  }

  // Shows or hides the new password.
  toggleNewPassword() {
    this.showNewPassword.update((v) => !v);
  }

  // Shows or hides the repeated new password.
  toggleConfirmPassword() {
    this.showConfirmPassword.update((v) => !v);
  }

  // Checks the fields (the server checks the current password), saves the new password and goes back to Settings.
  onSubmit() {
    this.errorMessage.set('');

    if (!this.currentPassword || !this.newPassword || !this.confirmPassword) {
      this.errorMessage.set('Please fill in all fields.');
      return;
    }

    if (this.newPassword.length > LIMITS.password) {
      this.errorMessage.set(`Passwords can be at most ${LIMITS.password} characters.`);
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('New passwords do not match.');
      return;
    }

    const currentUser = this.auth.currentUser();
    if (!currentUser) {
      this.errorMessage.set('You must be logged in.');
      return;
    }

    this.http
      .put<{ updated: boolean }>(`${API_URL}/users/${currentUser.id}/password`, {
        currentPassword: this.currentPassword,
        newPassword: this.newPassword,
        confirmPassword: this.confirmPassword,
      })
      .subscribe({
        next: () => {
          this.router.navigateByUrl('/settings');
        },
        error: (err) => {
          this.errorMessage.set(err.error?.message || 'Unable to change password.');
        },
      });
  }
}
