import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MyRequests } from './my-requests';
import { API_URL } from '../api.config';
import { Subject } from 'rxjs';
import { ChatSocketService } from '../services/chat-socket.service';
import { RefreshEvent } from '../models';

describe('MyRequests', () => {
  // Lets a test pretend the server sent a "refresh" event.
  const liveRefresh = new Subject<RefreshEvent>();

  let fixture: ComponentFixture<MyRequests>;
  let http: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const section = (title: string) => {
    // Request rows between this heading and the next one.
    const heading = [...el().querySelectorAll('h2')].find((h) => h.textContent?.trim() === title)!;
    const rows: string[] = [];
    for (let n = heading.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) {
      if (n.classList.contains('request-row'))
        rows.push(n.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    }
    return rows;
  };

  const base = { reviewedBy: null, rejectionReason: null };

  async function load(opts: { fail?: boolean } = {}) {
    fixture = TestBed.createComponent(MyRequests);
    fixture.detectChanges();
    if (opts.fail) {
      http.expectOne(`${API_URL}/groups`).flush({}, { status: 500, statusText: 'Error' });
    } else {
      http.expectOne(`${API_URL}/groups`).flush([{ id: 1, name: 'help', members: [] }]);
      http.expectOne(`${API_URL}/group-requests/mine`).flush([
        { ...base, id: 1, name: 'Chess', status: 'pending', createdAt: '2026-09-01T00:00:00Z' },
        {
          ...base,
          id: 2,
          name: 'Books',
          status: 'rejected',
          rejectionReason: 'Too similar to help',
          createdAt: '2026-09-03T00:00:00Z',
        },
        {
          ...base,
          id: 3,
          name: 'Approved one',
          status: 'approved',
          createdAt: '2026-09-04T00:00:00Z',
        },
      ]);
      http.expectOne(`${API_URL}/room-requests/mine`).flush([
        {
          ...base,
          id: 1,
          groupId: 1,
          name: 'memes',
          status: 'pending',
          createdAt: '2026-09-05T00:00:00Z',
        },
      ]);
      http
        .expectOne(`${API_URL}/join-requests/mine`)
        .flush([
          { ...base, id: 1, groupId: 99, status: 'rejected', createdAt: '2026-09-02T00:00:00Z' },
        ]);
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MyRequests],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ChatSocketService, useValue: { refresh$: liveRefresh } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('reloads when the server says a request was decided', async () => {
    await load();
    liveRefresh.next({ scope: 'requests' });
    http.expectOne(`${API_URL}/groups`).flush([]);
    http.expectOne(`${API_URL}/group-requests/mine`).flush([]);
    http.expectOne(`${API_URL}/room-requests/mine`).flush([]);
    http.expectOne(`${API_URL}/join-requests/mine`).flush([]);
  });

  it('lists pending requests of every kind, newest first, with group names', async () => {
    await load();
    const pending = section('Pending');
    expect(pending.length).toBe(2);
    expect(pending[0]).toContain('New room');
    expect(pending[0]).toContain('memes in help');
    expect(pending[1]).toContain('New group');
    expect(pending[1]).toContain('Chess');
  });

  it('lists rejected requests with their reason', async () => {
    await load();
    const rejected = section('Rejected');
    expect(rejected.length).toBe(2);
    expect(rejected[0]).toContain('Books');
    expect(rejected[0]).toContain('Reason: Too similar to help');
    expect(rejected[1]).toContain('Join group');
    expect(rejected[1]).toContain('a deleted group');
    expect(rejected[1]).toContain('Reason: No reason given');
  });

  it('leaves approved requests out', async () => {
    await load();
    expect(el().textContent).not.toContain('Approved one');
  });

  it('shows an error if loading fails', async () => {
    await load({ fail: true });
    expect(el().textContent).toContain('Unable to load your requests.');
  });
});
