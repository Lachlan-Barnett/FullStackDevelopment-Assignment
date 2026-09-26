import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface CurrentUser {
    id: number;
    email: string;
    username: string;
    birthdate: string;
    role: string;
}

interface AuthResponse extends Partial<CurrentUser> {
    valid: boolean;
    message?: string;
    token?: string;
}

const STORAGE_KEY = 'currentUser';
const TOKEN_KEY = 'authToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly http = inject(HttpClient);

    private readonly _currentUser = signal<CurrentUser | null>(this.readStoredUser());

    readonly currentUser = this._currentUser.asReadonly();
    readonly isLoggedIn = computed(() => this._currentUser() !== null);
    readonly isSuperAdmin = computed(() => this._currentUser()?.role === 'superadmin');

    login(email: string, password: string): Observable<AuthResponse> {
        return this.http
            .post<AuthResponse>('http://localhost:3000/api/auth', { email, password })
            .pipe(tap((response) => this.handleAuthResponse(response)));
    }

    signup(email: string, username: string, birthdate: string, password: string): Observable<AuthResponse> {
        return this.http
            .post<AuthResponse>('http://localhost:3000/api/signup', { email, username, birthdate, password })
            .pipe(tap((response) => this.handleAuthResponse(response)));
    }

    logout() {
        this._currentUser.set(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TOKEN_KEY);
    }

    getToken(): string | null {
        return localStorage.getItem(TOKEN_KEY);
    }

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