import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Groups } from './groups';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { Group, JoinRequest, RefreshEvent } from '../models';
import { Subject } from 'rxjs';
import { ChatSocketService } from '../services/chat-socket.service';

describe('Groups', () => {
  // Lets a test pretend the server sent a "refresh" event.
  const liveRefresh = new Subject<RefreshEvent>();

  let fixture: ComponentFixture<Groups>;
  let http: HttpTestingController;

  const groups: Group[] = [
    {
      id: 1,
      name: 'help',
      description: 'anything',
      ageLimit: 13,
      colourTheme: 'Blue',
      members: [{ userId: 2, role: 'admin' }],
    },
    {
      id: 2,
      name: 'games',
      description: 'play',
      ageLimit: 16,
      colourTheme: 'Red',
      members: [{ userId: 5, role: 'admin' }],
    },
    {
      id: 3,
      name: 'books',
      description: 'read',
      ageLimit: 0,
      colourTheme: 'Yellow',
      members: [{ userId: 5, role: 'admin' }],
    },
  ];

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = (text: string) =>
    [...el().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === text,
    )!;
  const setInput = async (selector: string, value: string) => {
    const input = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submitRequestForm = async () => {
    el().querySelector('form.request-form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  async function loadPage(myRequests: JoinRequest[] = []) {
    fixture = TestBed.createComponent(Groups);
    fixture.detectChanges();
    http.expectOne(`${API_URL}/groups`).flush(groups);
    http.expectOne(`${API_URL}/join-requests/mine`).flush(myRequests);
    await settle();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Groups],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ChatSocketService, useValue: { refresh$: liveRefresh } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 2, role: 'user' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  describe('searching and live updates', () => {
    it('filters the groups by name or description', async () => {
      await loadPage();
      await setInput('#groupSearch', 'PLAY');
      const rows = [...el().querySelectorAll('.group-row')].map((r) => r.textContent ?? '');
      expect(rows.length).toBe(1);
      expect(rows[0]).toContain('games');
      expect(el().textContent).toContain('1 of 3 groups');
      await setInput('#groupSearch', 'nothing like this');
      expect(el().textContent).toContain('No groups match "nothing like this".');
    });

    it('reloads when the server says the groups or requests changed', async () => {
      await loadPage();
      liveRefresh.next({ scope: 'requests' });
      http.expectOne(`${API_URL}/groups`).flush(groups);
      http.expectOne(`${API_URL}/join-requests/mine`).flush([]);
    });
  });

  describe('joining', () => {
    it('shows Admin, Pending, rejected reason and Apply states', async () => {
      await loadPage([
        {
          id: 1,
          groupId: 2,
          userId: 2,
          status: 'rejected',
          rejectionReason: 'You must be 16 or older',
          reviewedBy: null,
          createdAt: '',
        },
      ]);
      const rows = [...el().querySelectorAll('.group-row')].map((r) => r.textContent ?? '');
      expect(rows[0]).toContain('Admin');
      expect(rows[1]).toContain('Request rejected: You must be 16 or older');
      expect(rows[1]).toContain('Apply again');
      expect(rows[2]).toContain('Apply');
    });

    it('shows Banned with no Apply button for groups you were banned from', async () => {
      fixture = TestBed.createComponent(Groups);
      fixture.detectChanges();
      http.expectOne(`${API_URL}/groups`).flush([{ ...groups[1], isBanned: true }]);
      http.expectOne(`${API_URL}/join-requests/mine`).flush([]);
      await settle();
      const row = el().querySelector('.group-row')!;
      expect(row.textContent).toContain('Banned');
      expect(row.querySelector('button')).toBeNull();
    });

    it('sends a join request and shows Pending', async () => {
      await loadPage();
      const row = [...el().querySelectorAll('.group-row')][2];
      row.querySelector<HTMLButtonElement>('button')!.click();
      http
        .expectOne(`${API_URL}/groups/3/join-requests`)
        .flush({ id: 9, groupId: 3, status: 'pending' });
      http.expectOne(`${API_URL}/join-requests/mine`).flush([
        {
          id: 9,
          groupId: 3,
          userId: 2,
          status: 'pending',
          rejectionReason: null,
          reviewedBy: null,
          createdAt: '',
        },
      ]);
      await settle();
      expect(row.textContent).toContain('Pending');
    });
  });

  describe('leaving', () => {
    const leaveButton = () =>
      [...el().querySelectorAll('.group-row')][0].querySelector<HTMLButtonElement>(
        'button[aria-label="Leave help"]',
      )!;

    it('shows a Leave button on groups you belong to', async () => {
      await loadPage();
      expect(leaveButton()).not.toBeNull();
      expect(
        [...el().querySelectorAll('.group-row')][2].querySelector('button[aria-label^="Leave"]'),
      ).toBeNull();
    });

    it('leaves after confirming and reloads the groups', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      leaveButton().click();
      const del = http.expectOne(`${API_URL}/groups/1/membership`);
      expect(del.request.method).toBe('DELETE');
      del.flush({ left: true });
      http
        .expectOne(`${API_URL}/groups`)
        .flush([{ ...groups[0], members: [{ userId: 9, role: 'admin' }] }, groups[1], groups[2]]);
      await settle();
      expect([...el().querySelectorAll('.group-row')][0].textContent).toContain('Apply');
    });

    it('does nothing if cancelled', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      leaveButton().click();
      http.expectNone(`${API_URL}/groups/1/membership`);
    });

    it('shows why the only admin cannot leave', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      leaveButton().click();
      http.expectOne(`${API_URL}/groups/1/membership`).flush(
        {
          message:
            'You are the only admin. Promote another member first, or ask the super admin to delete the group.',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      expect(el().textContent).toContain('You are the only admin.');
    });
  });

  describe('requesting a new group', () => {
    beforeEach(async () => {
      await loadPage();
      button('Request a new group').click();
      await settle();
    });

    it('opens the form with labelled fields', () => {
      for (const id of [
        'newGroupName',
        'newGroupDescription',
        'newGroupAgeLimit',
        'newGroupColour',
      ]) {
        expect(el().querySelector(`label[for=${id}]`)).not.toBeNull();
      }
      const colours = [...el().querySelectorAll('#newGroupColour option')].map((o) =>
        o.textContent?.trim(),
      );
      expect(colours).toEqual(['Blue', 'Yellow', 'Red']);
    });

    it('sends the request and clears the form', async () => {
      await setInput('#newGroupName', '  Chess  ');
      await setInput('#newGroupDescription', 'Chess talk');
      await setInput('#newGroupAgeLimit', '12');
      await submitRequestForm();

      const req = http.expectOne(`${API_URL}/group-requests`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        name: 'Chess',
        description: 'Chess talk',
        ageLimit: 12,
        colourTheme: 'Blue',
      });
      req.flush({ id: 1, name: 'Chess' });
      await settle();

      expect(el().textContent).toContain('Request for "Chess" sent to the super admin.');
      expect(el().querySelector<HTMLInputElement>('#newGroupName')!.value).toBe('');
    });

    it('needs a name', async () => {
      await submitRequestForm();
      expect(el().textContent).toContain('Please give the group a name.');
      http.expectNone(`${API_URL}/group-requests`);
    });

    it('rejects a bad age limit', async () => {
      await setInput('#newGroupName', 'Chess');
      await setInput('#newGroupAgeLimit', '-3');
      await submitRequestForm();
      expect(el().textContent).toContain('Age limit must be a whole number from 0 to 120.');
      http.expectNone(`${API_URL}/group-requests`);
    });

    it('shows the server error, e.g. a duplicate name', async () => {
      await setInput('#newGroupName', 'help');
      await submitRequestForm();
      http
        .expectOne(`${API_URL}/group-requests`)
        .flush(
          { message: 'A group with that name already exists' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();
      expect(el().textContent).toContain('A group with that name already exists');
      expect(el().querySelector<HTMLInputElement>('#newGroupName')!.value).toBe('help');
    });
  });
});
