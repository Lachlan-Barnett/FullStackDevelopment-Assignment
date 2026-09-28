import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot } from '@angular/router';
import { signal } from '@angular/core';
import { notSuperAdminGuard } from './not-super-admin.guard';
import { AuthService } from '../services/auth.service';

describe('notSuperAdminGuard', () => {
  function run(isSuperAdmin: boolean) {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isSuperAdmin: signal(isSuperAdmin) } }],
    });
    return TestBed.runInInjectionContext(() =>
      notSuperAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  }

  it('lets normal users through', () => {
    expect(run(false)).toBe(true);
  });

  it('sends the super admin to their dashboard', () => {
    expect(String(run(true))).toBe('/admin/super');
  });
});
