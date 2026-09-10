import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

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
  protected email = '';
  protected username = '';
  protected dob = '';
  protected password = '';

  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }

  onSubmit() {
    this.auth.signup(this.email, this.username, this.dob, this.password).subscribe({
      next: (response) => {
        if (response.valid) {
          this.errorMessage.set('');
          this.router.navigateByUrl('/chat');
        } else {
          this.errorMessage.set(response.message ?? 'Unable to sign up');
        }
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message ?? 'Unable to reach the server.');
      },
    });
  }
}