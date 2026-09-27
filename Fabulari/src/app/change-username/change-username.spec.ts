import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ChangeUsername } from './change-username';

describe('ChangeUsername', () => {
  let component: ChangeUsername;
  let fixture: ComponentFixture<ChangeUsername>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangeUsername],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ChangeUsername);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
