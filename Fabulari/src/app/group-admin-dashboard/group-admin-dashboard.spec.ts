import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { GroupAdminDashboard } from './group-admin-dashboard';
import { AuthService } from '../services/auth.service';
import { API_URL } from '../api.config';
import { BannedMember, Group, JoinRequest, Report, Room, RoomRequest, User } from '../models';

describe('GroupAdminDashboard', () => {
  let fixture: ComponentFixture<GroupAdminDashboard>;
  let http: HttpTestingController;

  const group: Group = {
    id: 1,
    name: 'help',
    description: 'anything',
    ageLimit: 13,
    colourTheme: 'Blue',
    members: [
      { userId: 2, role: 'admin' },
      { userId: 3, role: 'member' },
    ],
  };
  const users: User[] = [
    { id: 2, email: 'u1@x', username: 'user1', birthdate: '2000-01-01', role: 'user' },
    { id: 3, email: 'u2@x', username: 'user2', birthdate: '2000-01-01', role: 'user' },
    { id: 7, email: 'new@x', username: 'newbie', birthdate: '1999-01-01', role: 'user' },
  ];
  const joinRequest: JoinRequest = {
    id: 4,
    groupId: 1,
    userId: 7,
    username: 'newbie',
    status: 'pending',
    rejectionReason: null,
    reviewedBy: null,
    createdAt: '2026-09-29T01:00:00.000Z',
  };
  const report: Report = {
    id: 8, reportedUserId: 3, reportedBy: 7, groupId: 1, reason: 'spamming the room', status: 'pending',
    createdAt: '2026-09-30T01:00:00.000Z', reporterName: 'newbie', reportedName: 'user2',
  };
  const roomRequests: RoomRequest[] = [
    { id: 1, groupId: 1, requestedBy: 3, requesterName: 'user2', name: 'memes', description: '', status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '' },
    { id: 2, groupId: 1, requestedBy: 2, requesterName: 'user1', name: 'news', description: '', status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '' },
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

  async function loadPage(joins: JoinRequest[] = [joinRequest], deletes: object[] = [], reports: Report[] = [report], banned: BannedMember[] = [], roomList: Room[] = []) {
    fixture = TestBed.createComponent(GroupAdminDashboard);
    fixture.detectChanges();
    http.expectOne(`${API_URL}/groups/1`).flush(group);
    http.expectOne(`${API_URL}/groups/1/rooms`).flush(roomList);
    http.expectOne(`${API_URL}/groups/1/room-requests`).flush(roomRequests);
    http.expectOne(`${API_URL}/groups/1/join-requests`).flush(joins);
    http.expectOne(`${API_URL}/groups/1/delete-requests`).flush(deletes);
    http.expectOne(`${API_URL}/groups/1/reports`).flush(reports);
    http.expectOne(`${API_URL}/groups/1/banned`).flush(banned);
    http.expectOne(`${API_URL}/users`).flush(users);
    await settle();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GroupAdminDashboard],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ groupId: '1' }) } } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 2, role: 'user' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  describe('group details', () => {
    async function save(ageLimit: string) {
      const age = panel('Group Details').querySelector<HTMLInputElement>('input[name=editAgeLimit]')!;
      age.value = ageLimit;
      age.dispatchEvent(new Event('input'));
      await settle();
      panel('Group Details').querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      return http.expectOne(`${API_URL}/groups/1`);
    }

    it('warns that raising the age limit removes members', async () => {
      await loadPage();
      expect(panel('Group Details').textContent).toContain('Raising the age limit removes members who are now too young.');
    });

    it('saves and names anyone removed by a higher age limit', async () => {
      await loadPage();
      const put = await save('18');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ description: 'anything', ageLimit: 18, colourTheme: 'Blue' });
      put.flush({ ...group, ageLimit: 18, members: [group.members[0]], removedMembers: [{ userId: 3, username: 'user2' }] });
      await settle();
      expect(panel('Group Details').textContent).toContain('Removed 1 member(s) under the new age limit: user2.');
      expect(panel('Members').textContent).not.toContain('user2');
    });

    it('says Saved when nobody was removed', async () => {
      await loadPage();
      (await save('13')).flush({ ...group, removedMembers: [] });
      await settle();
      expect(panel('Group Details').querySelector('[role=status]')?.textContent?.trim()).toBe('Saved.');
    });

    it('leaves the dashboard if the admin removed themselves', async () => {
      await loadPage();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      (await save('30')).flush({ ...group, removedMembers: [{ userId: 2, username: 'user1' }] });
      await settle();
      expect(navigate).toHaveBeenCalledWith('/chat');
    });

    it('shows the server error, e.g. no admin would be left', async () => {
      await loadPage();
      (await save('99')).flush(
        { message: 'An age limit of 99 would leave the group with no admin. Promote an older member first.' },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('would leave the group with no admin');
    });
  });

  describe('join requests', () => {
    it('lists pending join requests', async () => {
      await loadPage();
      expect(panel('Join Requests').textContent).toContain('newbie');
      expect(panel('Join Requests').textContent).toContain('wants to join');
    });

    it('shows an empty note when there are none', async () => {
      await loadPage([]);
      expect(panel('Join Requests').textContent).toContain('No pending join requests.');
    });

    it('approving adds the member and clears the request', async () => {
      await loadPage();
      buttonIn(panel('Join Requests'), 'Approve').click();
      const put = http.expectOne(`${API_URL}/groups/1/join-requests/4`);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ approve: true, reason: '' });
      put.flush({ ...joinRequest, status: 'approved' });

      http.expectOne(`${API_URL}/groups/1/join-requests`).flush([]);
      http.expectOne(`${API_URL}/groups/1`).flush({ ...group, members: [...group.members, { userId: 7, role: 'member' }] });
      await settle();

      expect(panel('Join Requests').textContent).toContain('No pending join requests.');
      expect(panel('Members').textContent).toContain('newbie');
    });

    it('rejecting sends the optional reason', async () => {
      await loadPage();
      const reason = panel('Join Requests').querySelector<HTMLInputElement>('input')!;
      reason.value = 'group is full';
      reason.dispatchEvent(new Event('input'));
      await settle();
      buttonIn(panel('Join Requests'), 'Reject').click();

      const put = http.expectOne(`${API_URL}/groups/1/join-requests/4`);
      expect(put.request.body).toEqual({ approve: false, reason: 'group is full' });
      put.flush({ ...joinRequest, status: 'rejected' });
      http.expectOne(`${API_URL}/groups/1/join-requests`).flush([]);
      http.expectNone(`${API_URL}/groups/1`); // no member change on reject
    });

    it('shows the server error, e.g. the user no longer meets the age limit', async () => {
      await loadPage();
      buttonIn(panel('Join Requests'), 'Approve').click();
      http
        .expectOne(`${API_URL}/groups/1/join-requests/4`)
        .flush({ message: 'That user no longer meets the group age limit' }, { status: 400, statusText: 'Bad Request' });
      http.expectOne(`${API_URL}/groups/1/join-requests`).flush([joinRequest]);
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('That user no longer meets the group age limit');
    });
  });

  describe('editing channels', () => {
    const start: Room = { id: 1, groupId: 1, name: 'strat', description: 'typo' };
    const load = () => loadPage([], [], [], [], [start]);
    const editButton = () => panel('Channels').querySelector<HTMLButtonElement>('button[aria-label="Edit strat"]')!;
    async function type(id: string, value: string) {
      const input = panel('Channels').querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    }

    it('opens an inline form filled with the current values', async () => {
      await load();
      editButton().click();
      await settle();
      expect(panel('Channels').querySelector<HTMLInputElement>('#room-name-1')!.value).toBe('strat');
      expect(panel('Channels').querySelector<HTMLInputElement>('#room-desc-1')!.value).toBe('typo');
    });

    it('saves the new name and description', async () => {
      await load();
      editButton().click();
      await settle();
      await type('room-name-1', ' start ');
      await type('room-desc-1', 'fixed');
      panel('Channels').querySelector('form')!.dispatchEvent(new Event('submit'));
      const put = http.expectOne(`${API_URL}/groups/1/rooms/1`);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ name: 'start', description: 'fixed' });
      put.flush({ ...start, name: 'start', description: 'fixed' });
      http.expectOne(`${API_URL}/groups/1/rooms`).flush([{ ...start, name: 'start', description: 'fixed' }]);
      await settle();
      expect(panel('Channels').querySelector('form')).toBeNull();
      expect(panel('Channels').textContent).toContain('start — fixed');
    });

    it('cancel closes the form without saving', async () => {
      await load();
      editButton().click();
      await settle();
      buttonIn(panel('Channels'), 'Cancel').click();
      await settle();
      expect(panel('Channels').querySelector('form')).toBeNull();
      http.expectNone(`${API_URL}/groups/1/rooms/1`);
    });

    it('needs a name', async () => {
      await load();
      editButton().click();
      await settle();
      await type('room-name-1', '  ');
      panel('Channels').querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('A room name is required.');
      http.expectNone(`${API_URL}/groups/1/rooms/1`);
    });

    it('shows the server error, e.g. a duplicate name', async () => {
      await load();
      editButton().click();
      await settle();
      await type('room-name-1', 'memes');
      panel('Channels').querySelector('form')!.dispatchEvent(new Event('submit'));
      http
        .expectOne(`${API_URL}/groups/1/rooms/1`)
        .flush({ message: 'This group already has a room with that name' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('already has a room with that name');
      expect(panel('Channels').querySelector('form')).not.toBeNull();
    });
  });

  describe('channel requests', () => {
    it("can't action your own request", async () => {
      await loadPage();
      const cards = [...panel('Channel Requests').querySelectorAll('.request-card')];
      expect(cards[0].querySelector('button')).not.toBeNull(); // user2's request
      expect(cards[1].textContent).toContain('another admin must review it'); // user1's own
      expect(cards[1].querySelector('button')).toBeNull();
    });

    it('needs a reason to reject', async () => {
      await loadPage();
      buttonIn(panel('Channel Requests'), 'Reject').click();
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('Enter a reason before rejecting "memes".');
      http.expectNone(`${API_URL}/groups/1/room-requests/1`);
    });
  });

  describe('reports', () => {
    it('lists reports with who reported whom and why', async () => {
      await loadPage();
      const text = panel('Reports').textContent ?? '';
      expect(text).toContain('user2');
      expect(text).toContain('reported by newbie');
      expect(text).toContain('spamming the room');
    });

    it('bans after confirming and removes the member', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      buttonIn(panel('Reports'), 'Ban from group').click();
      const put = http.expectOne(`${API_URL}/groups/1/reports/8`);
      expect(put.request.body).toEqual({ action: 'ban' });
      put.flush({ ...report, status: 'actioned' });
      http.expectOne(`${API_URL}/groups/1/reports`).flush([]);
      http.expectOne(`${API_URL}/groups/1`).flush({ ...group, members: [group.members[0]] });
      http
        .expectOne(`${API_URL}/groups/1/banned`)
        .flush([{ userId: 3, username: 'user2', bannedAt: '2026-09-30T02:00:00.000Z', bannedByName: 'user1', reason: 'spamming the room' }]);
      await settle();
      expect(panel('Reports').textContent).toContain('No reports to review.');
      expect(panel('Members').textContent).not.toContain('user2');
      expect(panel('Banned Members').textContent).toContain('user2');
    });

    it('does not ban if the confirmation is cancelled', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      buttonIn(panel('Reports'), 'Ban from group').click();
      http.expectNone(`${API_URL}/groups/1/reports/8`);
    });

    it('dismisses without banning', async () => {
      await loadPage();
      buttonIn(panel('Reports'), 'Dismiss').click();
      const put = http.expectOne(`${API_URL}/groups/1/reports/8`);
      expect(put.request.body).toEqual({ action: 'dismiss' });
      put.flush({ ...report, status: 'dismissed' });
      http.expectOne(`${API_URL}/groups/1/reports`).flush([]);
      http.expectNone(`${API_URL}/groups/1`);
    });

    it('asks the super admin to remove the user after confirming', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      buttonIn(panel('Reports'), 'Ask super admin to remove from Fabulari').click();
      const post = http.expectOne(`${API_URL}/groups/1/reports/8/escalate`);
      expect(post.request.method).toBe('POST');
      post.flush({});
      http.expectOne(`${API_URL}/groups/1/reports`).flush([]);
      await settle();
      expect(panel('Reports').textContent).toContain('No reports to review.');
    });

    it('cannot act on a report you filed', async () => {
      await loadPage([], [], [{ ...report, reportedBy: 2, reporterName: 'user1' }]);
      expect(panel('Reports').textContent).toContain('another admin must review it');
      expect(panel('Reports').querySelector('button')).toBeNull();
    });

    it('shows the server error, e.g. trying to ban an admin', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      buttonIn(panel('Reports'), 'Ban from group').click();
      http
        .expectOne(`${API_URL}/groups/1/reports/8`)
        .flush({ message: 'Admins cannot be banned. Demote them first.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(el().querySelector('.error-text')?.textContent).toContain('Admins cannot be banned');
    });
  });

  describe('banned members', () => {
    it('lists banned users with when, by whom and why', async () => {
      await loadPage([], [], [], [
        { userId: 3, username: 'user2', bannedAt: '2026-09-30T02:00:00.000Z', bannedByName: 'user1', reason: 'spamming' },
      ]);
      const text = panel('Banned Members').textContent?.replace(/\s+/g, ' ') ?? '';
      expect(text).toContain('user2');
      expect(text).toContain('banned 30 Sep 2026 by user1');
      expect(text).toContain('reason: spamming');
    });

    it('shows accounts removed from Fabulari as "Removed user"', async () => {
      await loadPage([], [], [], [{ userId: 9, username: null, bannedAt: '2026-09-30T02:00:00.000Z', bannedByName: 'user1', reason: null }]);
      expect(panel('Banned Members').textContent).toContain('Removed user');
    });

    it('shows an empty note and no unban option', async () => {
      await loadPage();
      expect(panel('Banned Members').textContent).toContain('Nobody has been banned from this group.');
      expect(panel('Banned Members').querySelector('button')).toBeNull();
    });
  });

  describe('deleting the group', () => {
    const pendingDelete = { id: 1, groupId: 1, groupName: 'help', requestedBy: 2, reason: '', status: 'pending', rejectionReason: null, reviewedBy: null, createdAt: '2026-09-30T01:00:00.000Z' };

    it('sends a deletion request after confirming', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const input = panel('Delete Group').querySelector<HTMLInputElement>('input')!;
      input.value = 'nobody uses it';
      input.dispatchEvent(new Event('input'));
      await settle();
      buttonIn(panel('Delete Group'), 'Request deletion').click();

      const post = http.expectOne(`${API_URL}/groups/1/delete-requests`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ reason: 'nobody uses it' });
      post.flush(pendingDelete);
      http.expectOne(`${API_URL}/groups/1/delete-requests`).flush([pendingDelete]);
      await settle();
      expect(panel('Delete Group').textContent).toContain('waiting for the super admin');
    });

    it('does nothing if the admin cancels the confirmation', async () => {
      await loadPage();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      buttonIn(panel('Delete Group'), 'Request deletion').click();
      http.expectNone(`${API_URL}/groups/1/delete-requests`);
    });

    it('shows a pending request instead of the button', async () => {
      await loadPage([joinRequest], [pendingDelete]);
      expect(panel('Delete Group').textContent).toContain('waiting for the super admin');
      expect(buttonIn(panel('Delete Group'), 'Request deletion')).toBeUndefined();
    });

    it('shows why the last request was rejected', async () => {
      await loadPage([joinRequest], [{ ...pendingDelete, status: 'rejected', rejectionReason: 'still active' }]);
      expect(panel('Delete Group').textContent).toContain('rejected: still active');
      expect(buttonIn(panel('Delete Group'), 'Request deletion')).toBeDefined();
    });
  });

  describe('members', () => {
    it('marks you and disables demoting the only admin', async () => {
      await loadPage();
      const rows = [...panel('Members').querySelectorAll('.member-row')];
      expect(rows[0].textContent).toContain('user1 (you)');
      expect(rows[0].querySelector('button')!.disabled).toBe(true);
      expect(rows[1].querySelector('button')!.disabled).toBe(false);
    });
  });
});
