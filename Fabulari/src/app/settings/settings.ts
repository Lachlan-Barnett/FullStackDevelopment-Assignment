import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService, CurrentUser } from '../services/auth.service';
import { API_URL, SERVER_URL } from '../api.config';

// Same limits as chat images: PNG only, at most 2MB. The server checks these again.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// The Settings page: the user's profile (photo, email, username, birthdate), the dark mode switch,
// and links to change the password, username and birthdate, My Requests and Submit Report.
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
  protected readonly currentUser = this.auth.currentUser;
  // Saved on the account (MongoDB), so the setting follows the user to any browser.
  protected readonly darkMode = computed(() => this.currentUser()?.darkMode === true);
  protected readonly themeError = signal('');
  protected readonly homeUrl = this.auth.homeUrl;
  protected readonly photoError = signal('');
  protected readonly photoBusy = signal(false);

  protected readonly photoUrl = computed(() => {
    const photo = this.currentUser()?.profilePhoto;
    return photo ? `${SERVER_URL}${photo}` : null;
  });

  protected readonly initial = computed(
    () => this.currentUser()?.username?.charAt(0).toUpperCase() ?? '?',
  );

  // Switches dark mode straight away (the App applies it), then saves it on the account.
  // If saving fails the switch is put back, so the page never shows a setting that wasn't saved.
  toggleTheme() {
    const user = this.currentUser();
    if (!user) return;
    const darkMode = !this.darkMode();
    this.themeError.set('');
    this.auth.updateCurrentUser({ darkMode });
    this.http.put<CurrentUser>(`${API_URL}/users/${user.id}`, { darkMode }).subscribe({
      error: (err) => {
        this.auth.updateCurrentUser({ darkMode: !darkMode });
        this.themeError.set(err.error?.message ?? 'Unable to save the dark mode setting.');
      },
    });
  }

  // Shows or hides the password on the profile panel.
  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }

  // Checks the chosen file is a PNG of at most 2MB, then uploads it as the new profile photo.
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

  // Removes the profile photo; the user's initial is shown instead.
  removePhoto() {
    const user = this.currentUser();
    if (!user) return;
    this.savePhoto(this.http.delete<CurrentUser>(`${API_URL}/users/${user.id}/photo`));
  }

  // Sends a photo change and updates the logged-in user (so every page shows the new photo) or shows the error.
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
