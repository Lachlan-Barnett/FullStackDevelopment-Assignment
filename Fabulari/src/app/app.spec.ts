import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    document.body.classList.remove('dark-theme');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the Fabulari logo', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const logo = (fixture.nativeElement as HTMLElement).querySelector('img.logo');
    expect(logo?.getAttribute('src')).toBe('fabulari-logo.png');
  });

  it('should apply dark mode on start-up when it was saved', () => {
    localStorage.setItem('darkMode', 'true');
    TestBed.createComponent(App);
    expect(document.body.classList.contains('dark-theme')).toBe(true);
  });

  it('should stay in light mode by default', () => {
    TestBed.createComponent(App);
    expect(document.body.classList.contains('dark-theme')).toBe(false);
  });
});
