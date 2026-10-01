import { Component, inject } from '@angular/core';
import { NotificationService } from '../services/notification.service';

// The pop-up messages in the bottom corner of every page, e.g. "Your room was approved".
// Screen readers announce each one as it appears.
@Component({
  selector: 'app-toasts',
  templateUrl: './toasts.html',
  styleUrl: './toasts.css',
})
export class Toasts {
  protected readonly notifications = inject(NotificationService);
}
