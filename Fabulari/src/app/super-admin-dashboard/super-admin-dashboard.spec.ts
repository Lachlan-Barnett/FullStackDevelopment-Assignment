import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { SuperAdminDashboard } from './super-admin-dashboard';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { GroupDeleteRequest, GroupRequest, SystemBanRequest } from '../models';

describe('SuperAdminDashboard', () => {
  let fixture: ComponentFixture<SuperAdminDashboard>;
  let http: HttpTestingController;

  const groupRequest: GroupRequest = {
    id: 1, requestedBy: 3, requesterName: 'user2', name: 'Chess', description: 'chess talk', ageLimit: 0,
    colourTheme: 'Red', status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '',
  };
  const deleteRequest: GroupDeleteRequest = {
    id: 5, groupId: 1, groupName: 'help', requestedBy: 2, requesterName: 'user1', reason: 'nobody uses it',
    status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '',
  };

  const removal: SystemBanRequest = {
    id: 9, userId: 3, username: 'user2', email: 'user2@com.au', groupId: 1, groupName: 'help', reportId: 8,
    reason: 'spamming', requestedBy: 2, requesterName: 'user1', status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '',
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const panel = (title: string) =>
    [...el().querySelectorAll('.panel')].find((p) => p.querySelector('.panel-title')?.textContent?.trim() === title)!;
  const buttonIn = (root: Element, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [SuperAdminDashboard],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 1, role: 'superadmin' }), logout: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(SuperAdminDashboard);
    fixture.detectChanges();
    http.expectOne(`${API_URL}/groups`).flush([]);
    http.expectOne(`${API_URL}/users`).flush([]);
    http.expectOne(`${API_URL}/admin/group-requests`).flush([groupRequest]);
    http.expectOne(`${API_URL}/admin/group-delete-requests`).flush([deleteRequest]);
    http.expectOne(`${API_URL}/admin/system-ban-requests`).flush([removal]);
    await settle();
  });

  it('lists group requests', () => {
    expect(panel('Group Requests').textContent).toContain('Chess');
    expect(panel('Group Requests').textContent).toContain('requested by user2');
  });

  it('approves a group request', () => {
    buttonIn(panel('Group Requests'), 'Approve').click();
    const put = http.expectOne(`${API_URL}/admin/group-requests/1`);
    expect(put.request.body).toEqual({ approve: true, reason: '' });
  });

  it('lists deletion requests with their reason', () => {
    const text = panel('Group Deletion Requests').textContent ?? '';
    expect(text).toContain('help');
    expect(text).toContain('requested by user1');
    expect(text).toContain('Reason: nobody uses it');
  });

  it('deletes the group after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    buttonIn(panel('Group Deletion Requests'), 'Delete group').click();
    const put = http.expectOne(`${API_URL}/admin/group-delete-requests/5`);
    expect(put.request.body).toEqual({ approve: true, reason: '' });
    put.flush({ ...deleteRequest, status: 'approved' });
    http.expectOne(`${API_URL}/admin/group-delete-requests`).flush([]);
    http.expectOne(`${API_URL}/groups`).flush([]);
    await settle();
    expect(panel('Group Deletion Requests').textContent).toContain('No pending deletion requests.');
  });

  it('does not delete if the confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    buttonIn(panel('Group Deletion Requests'), 'Delete group').click();
    http.expectNone(`${API_URL}/admin/group-delete-requests/5`);
  });

  it('rejects a deletion request without asking to confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    buttonIn(panel('Group Deletion Requests'), 'Reject').click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(http.expectOne(`${API_URL}/admin/group-delete-requests/5`).request.body).toEqual({ approve: false, reason: '' });
  });

  describe('user removal requests', () => {
    it('lists who, their email, who asked, the group and the report', () => {
      const text = panel('User Removal Requests').textContent ?? '';
      expect(text).toContain('user2 — user2@com.au');
      expect(text).toContain('requested by user1 in help');
      expect(text).toContain('Report: spamming');
    });

    it('removes the user after confirming and refreshes users and groups', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      buttonIn(panel('User Removal Requests'), 'Remove user').click();
      const put = http.expectOne(`${API_URL}/admin/system-ban-requests/9`);
      expect(put.request.body).toEqual({ approve: true, reason: '' });
      put.flush({ ...removal, status: 'approved' });
      http.expectOne(`${API_URL}/admin/system-ban-requests`).flush([]);
      http.expectOne(`${API_URL}/users`).flush([]);
      http.expectOne(`${API_URL}/groups`).flush([]);
    });

    it('does not remove if the confirmation is cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      buttonIn(panel('User Removal Requests'), 'Remove user').click();
      http.expectNone(`${API_URL}/admin/system-ban-requests/9`);
    });

    it('shows the server error, e.g. the user is the only admin of a group', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      buttonIn(panel('User Removal Requests'), 'Remove user').click();
      http
        .expectOne(`${API_URL}/admin/system-ban-requests/9`)
        .flush({ message: 'user2 is the only admin of "games". Another admin must be promoted first.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('only admin of "games"');
    });
  });
});
