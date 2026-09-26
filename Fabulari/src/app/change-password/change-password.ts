import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

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

  protected readonly showPassword0 = signal(false);
  protected readonly showPassword1 = signal(false);
  protected readonly showPassword2 = signal(false);
  protected readonly errorMessage = signal('');
  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';

  togglePasswordVisibility0() {
    this.showPassword0.update((v) => !v);
  }

  togglePasswordVisibility1() {
    this.showPassword1.update((v) => !v);
  }

  togglePasswordVisibility2() {
    this.showPassword2.update((v) => !v);
  }

  onSubmit() {
    this.errorMessage.set('');

    if (!this.currentPassword || !this.newPassword) {
      this.errorMessage.set('Please fill in all fields.');
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

    this.http.put<any>(`http://localhost:3000/api/users/${currentUser.id}/password`, {
      currentPassword: this.currentPassword,
      newPassword: this.newPassword,
    }).subscribe({
      next: () => {
        this.router.navigateByUrl('/settings');
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Unable to change password.');
      },
    });
  }
}
