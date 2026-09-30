import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ChangePassword } from './change-password';

describe('ChangePassword', () => {
  let fixture: ComponentFixture<ChangePassword>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangePassword],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ChangePassword);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('gives every field and checkbox a unique id with its own label', () => {
    const ids = [...el().querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(el().querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
  });

  it('each "Show" checkbox reveals only its own password field', async () => {
    const type = (id: string) => el().querySelector<HTMLInputElement>(`#${id}`)!.type;
    el().querySelector<HTMLInputElement>('#show-new-password')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(type('newPassword')).toBe('text');
    expect(type('currentPassword')).toBe('password');
    expect(type('confirmPassword')).toBe('password');
  });

  it('clicking a "Show" label toggles that checkbox, not another one', async () => {
    el().querySelector<HTMLLabelElement>('label[for="show-confirm-password"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector<HTMLInputElement>('#confirmPassword')!.type).toBe('text');
    expect(el().querySelector<HTMLInputElement>('#currentPassword')!.type).toBe('password');
  });
});
