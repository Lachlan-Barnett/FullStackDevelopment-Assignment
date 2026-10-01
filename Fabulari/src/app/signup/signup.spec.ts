import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Signup } from './signup';
import { API_URL } from '../api.config';

describe('Signup', () => {
  let fixture: ComponentFixture<Signup>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const error = () => el().querySelector('.alert-danger')?.textContent ?? '';

  // Fills in the form (any field left out keeps a valid value) and submits it.
  async function submit(
    fields: Partial<Record<'email' | 'username' | 'dob' | 'password', string>> = {},
  ) {
    const values = {
      email: 'new@t.com',
      username: 'newbie',
      dob: '2000-01-01',
      password: 'pw',
      ...fields,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = el().querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Signup],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Signup);
    await settle();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('checks the email before sending', async () => {
    await submit({ email: 'not-an-email' });
    expect(error()).toContain('Please enter a valid email address.');
    http.expectNone(`${API_URL}/signup`);
  });

  it('does not allow "@" in a username', async () => {
    await submit({ username: 'a@b' });
    expect(error()).toContain('Usernames cannot contain "@".');
    http.expectNone(`${API_URL}/signup`);
  });

  it('requires a date of birth that is not in the future', async () => {
    await submit({ dob: '' });
    expect(error()).toContain('Please enter your date of birth.');
    await submit({ dob: '2999-01-01' });
    expect(error()).toContain('cannot be in the future');
    http.expectNone(`${API_URL}/signup`);
  });

  it('does not offer future dates in the date picker', () => {
    expect(el().querySelector('#dob')?.getAttribute('max')).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it('sends valid details and shows the server error, e.g. a taken username', async () => {
    await submit({ email: ' New@T.com ' });
    const req = http.expectOne(`${API_URL}/signup`);
    expect(req.request.body).toEqual({
      email: 'New@T.com',
      username: 'newbie',
      birthdate: '2000-01-01',
      password: 'pw',
    });
    req.flush(
      { valid: false, message: 'That username is already taken' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(error()).toContain('That username is already taken');
  });
});
