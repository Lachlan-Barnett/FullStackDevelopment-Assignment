import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { SuperAdminDashboard } from './super-admin-dashboard';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { GroupDeleteRequest, GroupRequest } from '../models';

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
});
