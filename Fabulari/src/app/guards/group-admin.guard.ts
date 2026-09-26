import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

interface Group {
    members: { userId: number; role: string }[];
}

// Only lets the user into /admin/group/:groupId if they are an admin of that group.
// Admin status can change at any time, so it's checked against the server rather than cached.
export const groupAdminGuard: CanActivateFn = (route) => {
    const auth = inject(AuthService);
    const http = inject(HttpClient);
    const router = inject(Router);

    const userId = auth.currentUser()?.id;
    const groupId = route.paramMap.get('groupId');
    const backToChat = router.parseUrl('/chat');

    if (userId == null || !groupId) return backToChat;

    return http.get<Group>(`http://localhost:3000/api/groups/${groupId}`).pipe(
        map((group) => (group.members.some((m) => m.userId === userId && m.role === 'admin') ? true : backToChat)),
        catchError(() => of(backToChat)),
    );
};
