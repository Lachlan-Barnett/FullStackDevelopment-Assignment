import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Settings } from './settings';
import { AuthService, CurrentUser } from '../services/auth.service';
import { API_URL } from '../api.config';

describe('Settings', () => {
  let fixture: ComponentFixture<Settings>;
  let http: HttpTestingController;
  let currentUser: ReturnType<typeof signal<CurrentUser | null>>;
  let updateCurrentUser: ReturnType<typeof vi.fn>;

  const user: CurrentUser = {
    id: 2,
    email: 'user1@com.au',
    username: 'user1',
    birthdate: '2000-01-01',
    role: 'user',
    profilePhoto: null,
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const pick = (file: File) => ({ files: [file], value: 'x' }) as unknown as HTMLInputElement;
  const component = () => fixture.componentInstance as unknown as { uploadPhoto(i: HTMLInputElement): void; removePhoto(): void };

  beforeEach(async () => {
    currentUser = signal<CurrentUser | null>(user);
    updateCurrentUser = vi.fn((changes: Partial<CurrentUser>) => currentUser.update((u) => ({ ...u!, ...changes })));

    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser, updateCurrentUser, homeUrl: signal('/chat') } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Settings);
    await settle();
  });

  it("the back arrow goes to the user's home page", () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el().querySelector<HTMLButtonElement>('.back-btn')!.click();
    expect(String(navigate.mock.calls[0][0])).toBe('/chat');
  });

  it('shows the profile details', () => {
    expect(el().textContent).toContain('user1@com.au');
    expect(el().textContent).toContain('user1');
  });

  it('shows the initial and "Add photo" when there is no photo', () => {
    expect(el().querySelector('.avatar-initial')?.textContent?.trim()).toBe('U');
    expect(el().textContent).toContain('Add photo');
    expect(el().textContent).not.toContain('Remove');
  });

  it('uploads a PNG and shows the new photo', async () => {
    component().uploadPhoto(pick(new File([new Uint8Array(10)], 'me.png', { type: 'image/png' })));
    const req = http.expectOne(`${API_URL}/users/2/photo`);
    expect(req.request.method).toBe('PUT');
    expect((req.request.body as FormData).get('image')).toBeInstanceOf(File);
    req.flush({ ...user, profilePhoto: '/uploads/avatars/2.png?v=1' });
    await settle();

    expect(updateCurrentUser).toHaveBeenCalledWith({ profilePhoto: '/uploads/avatars/2.png?v=1' });
    const img = el().querySelector<HTMLImageElement>('img.avatar-large');
    expect(img?.getAttribute('src')).toBe('http://localhost:3000/uploads/avatars/2.png?v=1');
    expect(el().textContent).toContain('Change photo');
  });

  it('rejects non-PNG and oversized photos without uploading', async () => {
    component().uploadPhoto(pick(new File([new Uint8Array(10)], 'me.jpg', { type: 'image/jpeg' })));
    await settle();
    expect(el().textContent).toContain('Profile photos must be PNG images.');

    component().uploadPhoto(pick(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })));
    await settle();
    expect(el().textContent).toContain('Profile photos must be 2MB or smaller.');
    http.expectNone(`${API_URL}/users/2/photo`);
  });

  it('removes the photo', async () => {
    currentUser.set({ ...user, profilePhoto: '/uploads/avatars/2.png?v=1' });
    await settle();
    component().removePhoto();
    const req = http.expectOne(`${API_URL}/users/2/photo`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ...user, profilePhoto: null });
    await settle();
    expect(updateCurrentUser).toHaveBeenCalledWith({ profilePhoto: null });
    expect(el().querySelector('.avatar-initial')).not.toBeNull();
  });

  it('shows the server error when the upload is rejected', async () => {
    component().uploadPhoto(pick(new File([new Uint8Array(10)], 'me.png', { type: 'image/png' })));
    http
      .expectOne(`${API_URL}/users/2/photo`)
      .flush({ message: 'Only PNG images are allowed' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el().textContent).toContain('Only PNG images are allowed');
  });
});
