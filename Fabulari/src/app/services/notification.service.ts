import { Injectable, signal } from '@angular/core';

// One pop-up message in the corner of the screen.
export interface Toast {
  id: number;
  message: string;
}

// How long a pop-up stays on screen, and how many can be shown at once.
const TOAST_DURATION_MS = 6000;
const MAX_TOASTS = 4;

// Short pop-up messages ("toasts"), e.g. "Your room was approved". The server pushes most of them over the
// socket (see ChatSocketService); pages can also show their own. The Toasts component displays them.
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 0;
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  // Shows a message for a few seconds. Only the newest few are kept so the screen never fills up.
  show(message: string) {
    const id = ++this.nextId;
    this._toasts.update((toasts) => [...toasts, { id, message }].slice(-MAX_TOASTS));
    setTimeout(() => this.dismiss(id), TOAST_DURATION_MS);
  }

  // Removes a message straight away (its close button, or when its time is up).
  dismiss(id: number) {
    this._toasts.update((toasts) => toasts.filter((t) => t.id !== id));
  }
}
