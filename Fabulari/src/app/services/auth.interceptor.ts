import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

// Adds the login token to every request, and sends the user back to the login
// page if the server says the token is missing, expired or no longer valid.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const token = auth.getToken();
    const request = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

    return next(request).pipe(
        catchError((err: HttpErrorResponse) => {
            if (err.status === 401 && token) {
                auth.logout();
                router.navigateByUrl('/');
            }
            return throwError(() => err);
        }),
    );
};
