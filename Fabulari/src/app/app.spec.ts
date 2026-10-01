import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { App } from './app';
import { AuthService } from './services/auth.service';
import { ChatSocketService } from './services/chat-socket.service';
import { NotificationService } from './services/notification.service';
import { User } from './models';

describe('App', () => {
  const currentUser = signal<Partial<User> | null>(null);

  beforeEach(async () => {
    document.body.classList.remove('dark-theme');
    currentUser.set(null);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser } },
        { provide: ChatSocketService, useValue: {} },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the Fabulari logo', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const logo = (fixture.nativeElement as HTMLElement).querySelector('img.logo');
    expect(logo?.getAttribute('src')).toBe('fabulari-logo.png');
  });

  it("applies the logged-in user's saved dark mode setting", async () => {
    currentUser.set({ id: 3, darkMode: true });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(document.body.classList.contains('dark-theme')).toBe(true);
  });

  it('switches straight away when the setting changes, and is light when logged out', async () => {
    currentUser.set({ id: 3, darkMode: true });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    currentUser.set({ id: 3, darkMode: false });
    await fixture.whenStable();
    expect(document.body.classList.contains('dark-theme')).toBe(false);
    currentUser.set({ id: 3, darkMode: true });
    await fixture.whenStable();
    currentUser.set(null);
    await fixture.whenStable();
    expect(document.body.classList.contains('dark-theme')).toBe(false);
  });

  it('shows pop-up notifications on every page', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(NotificationService).show('Your room was approved');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.toast-card')?.textContent,
    ).toContain('Your room was approved');
  });
});
