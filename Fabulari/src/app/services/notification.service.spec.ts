import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => vi.useRealTimers());

  it('shows a message and hides it again after a few seconds', () => {
    service.show('Your room was approved');
    expect(service.toasts().map((t) => t.message)).toEqual(['Your room was approved']);
    vi.advanceTimersByTime(6000);
    expect(service.toasts()).toEqual([]);
  });

  it('can be dismissed straight away', () => {
    service.show('hello');
    service.dismiss(service.toasts()[0].id);
    expect(service.toasts()).toEqual([]);
  });

  it('keeps only the newest four messages on screen', () => {
    for (const n of [1, 2, 3, 4, 5]) service.show(`message ${n}`);
    expect(service.toasts().map((t) => t.message)).toEqual([
      'message 2',
      'message 3',
      'message 4',
      'message 5',
    ]);
  });
});
