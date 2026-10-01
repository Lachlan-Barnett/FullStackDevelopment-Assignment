import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { API_URL } from '../api.config';
import { User } from '../models';

// The logged-in user is just a User; the alias makes intent clearer where it's used.
export type CurrentUser = User;

interface AuthResponse extends Partial<CurrentUser> {
  valid: boolean;
  message?: string;
  token?: string;
}

const STORAGE_KEY = 'currentUser';
const TOKEN_KEY = 'authToken';

// Logging in, signing up and out, and the logged-in user. The user and their login token are kept in
// localStorage so a page reload keeps them logged in; the server still checks the token on every request.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _currentUser = signal<CurrentUser | null>(this.readStoredUser());
  readonly currentUser = this._currentUser.asReadonly();

  readonly isLoggedIn = computed(() => this._currentUser() !== null);
  readonly isSuperAdmin = computed(() => this._currentUser()?.role === 'superadmin');

  // Where a user lands after logging in. The super admin doesn't chat, so they go to their dashboard.
  readonly homeUrl = computed(() => (this.isSuperAdmin() ? '/admin/super' : '/chat'));

  // Logs in with an email or a username (the server works out which) and the password.
  login(login: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_URL}/auth`, { login, password })
      .pipe(tap((response) => this.handleAuthResponse(response)));
  }

  // Creates an account and logs straight in.
  signup(
    email: string,
    username: string,
    birthdate: string,
    password: string,
  ): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_URL}/signup`, { email, username, birthdate, password })
      .pipe(tap((response) => this.handleAuthResponse(response)));
  }

  // Forgets the user and their token. Pages watching currentUser react (e.g. the socket disconnects).
  logout() {
    this._currentUser.set(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }

  // Merges profile changes (e.g. a new username) into the logged-in user so every page sees them.
  updateCurrentUser(changes: Partial<CurrentUser>) {
    const user = this._currentUser();
    if (!user) return;
    const updated = { ...user, ...changes };
    this._currentUser.set(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  // The login token sent with every request (see authInterceptor) and the socket connection.
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  // Stores the user and token after a successful login or sign-up.
  private handleAuthResponse(response: AuthResponse) {
    if (!response.valid || !response.token) return;
    const { valid, message, token, ...user } = response;
    this._currentUser.set(user as CurrentUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(TOKEN_KEY, token);
  }

  // A stored user without a token is from before login tokens existed, so treat it as logged out.
  private readStoredUser(): CurrentUser | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored || !localStorage.getItem(TOKEN_KEY)) return null;
    return JSON.parse(stored);
  }
}
