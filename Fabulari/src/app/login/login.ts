import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

// The login page. Users log in with their email or username and their password.
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly showPassword = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly sending = signal(false);
  protected login = '';
  protected password = '';

  // Shows or hides the password as it is typed.
  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }

  // Checks both fields are filled in, then logs in and goes to the user's home page.
  onSubmit() {
    this.errorMessage.set('');
    if (!this.login.trim() || !this.password) {
      this.errorMessage.set('Enter your email or username, and your password.');
      return;
    }

    this.sending.set(true);
    this.auth.login(this.login.trim(), this.password).subscribe({
      next: (response) => {
        this.sending.set(false);
        if (response.valid) {
          this.router.navigateByUrl(this.auth.homeUrl());
        } else {
          this.errorMessage.set('Incorrect email, username or password.');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        // Status 0 means the request never reached the server.
        this.errorMessage.set(
          err.status === 0
            ? 'Unable to reach the server.'
            : (err.error?.message ?? 'Unable to log in.'),
        );
      },
    });
  }
}
