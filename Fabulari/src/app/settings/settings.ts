import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-settings',
  imports: [RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  protected readonly showPassword = signal(false);
  protected readonly darkMode = signal(localStorage.getItem('darkMode') === 'true');
  protected readonly currentUser = inject(AuthService).currentUser;

  toggleTheme() {
  this.darkMode.update((v) => !v);
  document.body.classList.toggle('dark-theme', this.darkMode());
  localStorage.setItem('darkMode', String(this.darkMode()));
}

  togglePasswordVisibility() {
    this.showPassword.update((v) => !v);
  }
}