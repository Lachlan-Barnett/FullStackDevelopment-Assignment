import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser } from '../services/auth.service';
import { API_URL } from '../api.config';

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

  protected readonly errorMessage = signal('');
  protected newBirthdate = '';

  onSubmit() {
    this.errorMessage.set('');

    if (!this.newBirthdate) {
      this.errorMessage.set('Please choose a birthdate.');
      return;
    }

    const currentUser = this.auth.currentUser();
    if (!currentUser) {
      this.errorMessage.set('You must be logged in.');
      return;
    }

    this.http.put<CurrentUser>(`${API_URL}/users/${currentUser.id}`, {
      birthdate: this.newBirthdate,
    }).subscribe({
      next: (updatedUser) => {
        this.auth.updateCurrentUser(updatedUser);
        this.router.navigateByUrl('/settings');
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Unable to change birthdate.');
      },
    });
  }
}
