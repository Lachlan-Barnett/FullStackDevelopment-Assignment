import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { ChangeBirthdate } from './change-birthdate';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { API_URL } from '../api.config';

describe('ChangeBirthdate', () => {
  let fixture: ComponentFixture<ChangeBirthdate>;
  let http: HttpTestingController;
  const updateCurrentUser = vi.fn();

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  async function submit(date: string) {
    const input = el().querySelector<HTMLInputElement>('#newBirthdate')!;
    input.value = date;
    input.dispatchEvent(new Event('input'));
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  beforeEach(async () => {
    updateCurrentUser.mockReset();
    TestBed.configureTestingModule({
      imports: [ChangeBirthdate],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 3, username: 'user2' }), updateCurrentUser },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ChangeBirthdate);
    await settle();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('does not accept a birthdate in the future', async () => {
    await submit('2999-01-01');
    expect(el().querySelector('.alert-danger')?.textContent).toContain('cannot be in the future');
    http.expectNone(`${API_URL}/users/3`);
  });

  it('saves the birthdate and says which groups the user was removed from', async () => {
    const show = vi.spyOn(TestBed.inject(NotificationService), 'show');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await submit('2016-01-01');
    const req = http.expectOne(`${API_URL}/users/3`);
    expect(req.request.body).toEqual({ birthdate: '2016-01-01' });
    req.flush({
      id: 3,
      birthdate: '2016-01-01',
      removedFrom: [{ id: 1, name: 'help', ageLimit: 13 }],
    });
    await settle();
    expect(updateCurrentUser).toHaveBeenCalledWith({ birthdate: '2016-01-01' });
    expect(show).toHaveBeenCalledWith('You were removed from "help" because its age limit is 13.');
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it("shows the server's reason when the change is refused", async () => {
    await submit('2016-01-01');
    http.expectOne(`${API_URL}/users/3`).flush(
      {
        message:
          'You are the only admin of "help", which has an age limit of 13. Promote another member first.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    expect(el().querySelector('.alert-danger')?.textContent).toContain('only admin of "help"');
  });
});
