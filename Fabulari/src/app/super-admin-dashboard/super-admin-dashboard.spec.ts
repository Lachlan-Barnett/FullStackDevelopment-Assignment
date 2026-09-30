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

  const auditEntries = [
    { id: 2, type: 'GROUP_CREATED', actorId: 1, actorName: 'admin', targetType: 'group', targetId: 2, details: 'Approved and created the group "Chess"', timestamp: '2026-09-30T03:00:00.000Z' },
    { id: 1, type: 'USER_SIGNED_UP', actorId: 4, actorName: 'carol', targetType: 'user', targetId: 4, details: 'carol (c@t.com) created an account', timestamp: '2026-09-30T02:00:00.000Z' },
  ];

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
    http.expectOne(`${API_URL}/admin/audit-log?order=newest`).flush({ types: ['GROUP_CREATED', 'USER_SIGNED_UP'], entries: auditEntries });
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

  describe('audit log', () => {
    it('lists entries with type, who and what', () => {
      const entries = [...panel('Audit Log').querySelectorAll('.audit-entry')].map((e) => e.textContent?.replace(/\s+/g, ' ') ?? '');
      expect(entries.length).toBe(2);
      expect(entries[0]).toContain('GROUP_CREATED');
      expect(entries[0]).toContain('admin: Approved and created the group "Chess"');
      expect(entries[1]).toContain('carol: carol (c@t.com) created an account');
    });

    it('offers every type in the filter', () => {
      const options = [...panel('Audit Log').querySelectorAll('#auditType option')].map((o) => o.textContent?.trim());
      expect(options).toEqual(['All types', 'GROUP_CREATED', 'USER_SIGNED_UP']);
    });

    it('filters by type', async () => {
      const select = panel('Audit Log').querySelector<HTMLSelectElement>('#auditType')!;
      select.value = 'USER_SIGNED_UP';
      select.dispatchEvent(new Event('change'));
      await settle();
      http.expectOne(`${API_URL}/admin/audit-log?order=newest&type=USER_SIGNED_UP`).flush({ types: [], entries: [auditEntries[1]] });
      await settle();
      expect(panel('Audit Log').querySelectorAll('.audit-entry').length).toBe(1);
    });

    it('switches between newest and oldest first', async () => {
      buttonIn(panel('Audit Log'), 'Newest first').click();
      await settle();
      http.expectOne(`${API_URL}/admin/audit-log?order=oldest`).flush({ types: [], entries: [...auditEntries].reverse() });
      await settle();
      expect(buttonIn(panel('Audit Log'), 'Oldest first')).toBeDefined();
      expect(panel('Audit Log').querySelector('.audit-entry')?.textContent).toContain('USER_SIGNED_UP');
    });

    it('refreshes after the super admin acts', () => {
      buttonIn(panel('Group Requests'), 'Approve').click();
      http.expectOne(`${API_URL}/admin/group-requests/1`).flush({});
      http.expectOne(`${API_URL}/admin/group-requests`).flush([]);
      http.expectOne(`${API_URL}/admin/audit-log?order=newest`).flush({ types: [], entries: [] });
    });
  });
});
