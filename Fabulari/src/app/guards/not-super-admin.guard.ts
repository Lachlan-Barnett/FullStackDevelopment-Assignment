import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Keeps the super admin out of the chat and group-browsing pages; they don't take part in chat.
export const notSuperAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isSuperAdmin() ? router.parseUrl('/admin/super') : true;
};
