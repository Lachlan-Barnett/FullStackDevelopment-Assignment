import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { ChatSocketService } from './services/chat-socket.service';
import { Toasts } from './toasts/toasts';

// The page shell: logo, the current page, and the pop-up notifications.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toasts],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly auth = inject(AuthService);

  // Starts the live connection and keeps the page's colours in step with the user's dark mode setting.
  constructor() {
    // Starting the socket service here keeps live notifications working on every page, not just chat.
    inject(ChatSocketService);

    // Dark mode is saved on the user's account, so it follows them to any browser. Logged out is light.
    effect(() => {
      document.body.classList.toggle('dark-theme', this.auth.currentUser()?.darkMode === true);
    });
  }
}
