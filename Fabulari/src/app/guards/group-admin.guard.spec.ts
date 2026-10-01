import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  provideRouter,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable, of } from 'rxjs';
import { signal } from '@angular/core';
import { groupAdminGuard } from './group-admin.guard';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';

describe('groupAdminGuard', () => {
  let http: HttpTestingController;

  function setup(userId: number | null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { currentUser: signal(userId == null ? null : { id: userId }) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  function runGuard(groupId: string) {
    const route = { paramMap: convertToParamMap({ groupId }) } as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      groupAdminGuard(route, {} as RouterStateSnapshot),
    );
    return isObservable(result)
      ? firstValueFrom(result as Observable<boolean | UrlTree>)
      : firstValueFrom(of(result));
  }

  const group = {
    members: [
      { userId: 2, role: 'admin' },
      { userId: 3, role: 'member' },
    ],
  };

  it('allows an admin of the group', async () => {
    setup(2);
    const result = runGuard('1');
    http.expectOne(`${API_URL}/groups/1`).flush(group);
    expect(await result).toBe(true);
  });

  it('redirects a plain member to /chat', async () => {
    setup(3);
    const result = runGuard('1');
    http.expectOne(`${API_URL}/groups/1`).flush(group);
    expect(String(await result)).toBe('/chat');
  });

  it('redirects to /chat when the group does not exist', async () => {
    setup(2);
    const result = runGuard('99');
    http.expectOne(`${API_URL}/groups/99`).flush({}, { status: 404, statusText: 'Not Found' });
    expect(String(await result)).toBe('/chat');
  });

  it('redirects to /chat without calling the server when nobody is logged in', async () => {
    setup(null);
    expect(String(await runGuard('1'))).toBe('/chat');
    http.expectNone(`${API_URL}/groups/1`);
  });
});
