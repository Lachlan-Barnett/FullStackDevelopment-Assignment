import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { birthdateError, isValidEmail, LIMITS, today, usernameError } from '../validation';

// The sign-up page: email, username, date of birth and password. New accounts are always normal users.
@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly showPassword = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly sending = signal(false);
  protected readonly limits = LIMITS;
  protected readonly maxBirthdate = today();
  protected email = '';
  protected username = '';
  protected dob = '';
  protected password = '';

  // Shows or hides the password as it is typed.
  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }

  // The first problem with the form, or '' when everything can be sent.
  private validate(): string {
    if (!isValidEmail(this.email.trim())) return 'Please enter a valid email address.';
    const nameProblem = usernameError(this.username);
    if (nameProblem) return nameProblem;
    const dobProblem = birthdateError(this.dob);
    if (dobProblem) return dobProblem;
    if (!this.password) return 'Please enter a password.';
    return '';
  }

  // Checks the form, creates the account and logs straight in.
  onSubmit() {
    const problem = this.validate();
    this.errorMessage.set(problem);
    if (problem) return;

    this.sending.set(true);
    this.auth.signup(this.email.trim(), this.username.trim(), this.dob, this.password).subscribe({
      next: (response) => {
        this.sending.set(false);
        if (response.valid) {
          this.router.navigateByUrl(this.auth.homeUrl());
        } else {
          this.errorMessage.set(response.message ?? 'Unable to sign up');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.errorMessage.set(
          err.status === 0
            ? 'Unable to reach the server.'
            : (err.error?.message ?? 'Unable to sign up.'),
        );
      },
    });
  }
}
