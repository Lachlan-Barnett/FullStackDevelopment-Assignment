import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ChangeUsername } from './change-username';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';

describe('ChangeUsername', () => {
  let fixture: ComponentFixture<ChangeUsername>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  async function submit(name: string) {
    const input = el().querySelector<HTMLInputElement>('#newUsername')!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ChangeUsername],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 3, username: 'user2' }),
            updateCurrentUser: vi.fn(),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ChangeUsername);
    await settle();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('does not allow a blank username or one with "@"', async () => {
    await submit('   ');
    expect(el().querySelector('.alert-danger')?.textContent).toContain('Please enter a username.');
    await submit('me@home');
    expect(el().querySelector('.alert-danger')?.textContent).toContain('cannot contain "@"');
    http.expectNone(`${API_URL}/users/3`);
  });

  it('says when the username is already taken', async () => {
    await submit('user1');
    const req = http.expectOne(`${API_URL}/users/3`);
    expect(req.request.body).toEqual({ username: 'user1' });
    req.flush(
      { message: 'That username is already taken' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(el().querySelector('.alert-danger')?.textContent).toContain(
      'That username is already taken',
    );
  });
});
