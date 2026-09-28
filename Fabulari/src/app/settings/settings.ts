import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService, CurrentUser } from '../services/auth.service';
import { API_URL, SERVER_URL } from '../api.config';

// Same limits as chat images: PNG only, at most 2MB. The server checks these again.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-settings',
  imports: [RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  protected readonly showPassword = signal(false);
  protected readonly darkMode = signal(localStorage.getItem('darkMode') === 'true');
  protected readonly currentUser = this.auth.currentUser;
  protected readonly homeUrl = this.auth.homeUrl;
  protected readonly photoError = signal('');
  protected readonly photoBusy = signal(false);

  protected readonly photoUrl = computed(() => {
    const photo = this.currentUser()?.profilePhoto;
    return photo ? `${SERVER_URL}${photo}` : null;
  });

  protected readonly initial = computed(() => this.currentUser()?.username?.charAt(0).toUpperCase() ?? '?');

  toggleTheme() {
    this.darkMode.update((v) => !v);
    document.body.classList.toggle('dark-theme', this.darkMode());
    localStorage.setItem('darkMode', String(this.darkMode()));
  }

  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }

  uploadPhoto(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ''; // allow choosing the same file again later
    const user = this.currentUser();
    if (!file || !user) return;

    if (file.type !== 'image/png') {
      this.photoError.set('Profile photos must be PNG images.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      this.photoError.set('Profile photos must be 2MB or smaller.');
      return;
    }

    const form = new FormData();
    form.append('image', file);
    this.savePhoto(this.http.put<CurrentUser>(`${API_URL}/users/${user.id}/photo`, form));
  }

  removePhoto() {
    const user = this.currentUser();
    if (!user) return;
    this.savePhoto(this.http.delete<CurrentUser>(`${API_URL}/users/${user.id}/photo`));
  }

  private savePhoto(request: Observable<CurrentUser>) {
    this.photoError.set('');
    this.photoBusy.set(true);
    request.subscribe({
      next: (updated) => {
        this.auth.updateCurrentUser({ profilePhoto: updated.profilePhoto ?? null });
        this.photoBusy.set(false);
      },
      error: (err) => {
        this.photoError.set(err.error?.message ?? 'Unable to update your photo.');
        this.photoBusy.set(false);
      },
    });
  }
}
