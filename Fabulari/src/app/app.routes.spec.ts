import { routes } from './app.routes';
import { authGuard } from './guards/auth.guard';
import { notSuperAdminGuard } from './guards/not-super-admin.guard';

describe('routes', () => {
  const route = (path: string) => routes.find((r) => r.path === path)!;

  it('sends unknown addresses to the login page instead of showing a blank page', () => {
    const last = routes[routes.length - 1];
    expect(last.path).toBe('**');
    expect(last.redirectTo).toBe('');
  });

  it('keeps the super admin out of the pages for group members', () => {
    for (const path of ['chat', 'groups', 'requests', 'report']) {
      expect(route(path).canActivate).toEqual([authGuard, notSuperAdminGuard]);
    }
  });

  it('protects every page except login and sign-up with authGuard', () => {
    const open = routes
      .filter((r) => r.path !== '**' && !r.canActivate?.includes(authGuard))
      .map((r) => r.path);
    expect(open).toEqual(['', 'signup']);
  });
});
