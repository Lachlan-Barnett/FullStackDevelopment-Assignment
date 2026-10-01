import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Login } from './login';
import { API_URL } from '../api.config';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  async function fillIn(login: string, password: string) {
    const loginInput = el().querySelector<HTMLInputElement>('#login')!;
    const passwordInput = el().querySelector<HTMLInputElement>('#password')!;
    loginInput.value = login;
    loginInput.dispatchEvent(new Event('input'));
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Login);
    await settle();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('asks for an email or username', () => {
    expect(el().querySelector('label[for=login]')?.textContent).toContain('Email or username');
  });

  it('checks both fields are filled in before asking the server', async () => {
    await fillIn('', '');
    expect(el().querySelector('.alert-danger')?.textContent).toContain(
      'Enter your email or username, and your password.',
    );
    http.expectNone(`${API_URL}/auth`);
  });

  it('logs in with a username and goes to the chat page', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await fillIn(' user2 ', '123');
    const req = http.expectOne(`${API_URL}/auth`);
    expect(req.request.body).toEqual({ login: 'user2', password: '123' });
    req.flush({
      valid: true,
      token: 't',
      id: 3,
      email: 'user2@com.au',
      username: 'user2',
      role: 'user',
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith('/chat');
  });

  it('says when the details are wrong', async () => {
    await fillIn('user2', 'nope');
    http.expectOne(`${API_URL}/auth`).flush({ valid: false });
    await settle();
    expect(el().querySelector('.alert-danger')?.textContent).toContain(
      'Incorrect email, username or password.',
    );
  });

  it("shows the server's message when the server refuses the request", async () => {
    await fillIn('user2', 'x');
    http
      .expectOne(`${API_URL}/auth`)
      .flush(
        { valid: false, message: 'Enter your email or username, and your password' },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle();
    expect(el().querySelector('.alert-danger')?.textContent).toContain(
      'Enter your email or username, and your password',
    );
  });

  it('says when the server cannot be reached', async () => {
    await fillIn('user2', 'x');
    http.expectOne(`${API_URL}/auth`).error(new ProgressEvent('error'), { status: 0 });
    await settle();
    expect(el().querySelector('.alert-danger')?.textContent).toContain(
      'Unable to reach the server.',
    );
  });
});
