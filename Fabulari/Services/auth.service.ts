import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface CurrentUser {
    id: number;
    email: string;
    username: string;
    birthdate: string;
    rold: string;
}

interface AuthResponse extends Partial<CurrentUser> {
    valid: boolean;
    message?: string;
}

const STORAGE_KEY = 'currentUser';

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
    }

    private handleAuthResponse(response: AuthResponse) {
        if (!response.valid) return;
        const { valid, message, ...user } = response;
        this._currentUser.set(user as CurrentUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    }

    private readStoredUser(): CurrentUser | null {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    }
}