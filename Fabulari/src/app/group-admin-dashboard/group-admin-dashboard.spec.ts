import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { GroupAdminDashboard } from './group-admin-dashboard';

describe('GroupAdminDashboard', () => {
  let component: GroupAdminDashboard;
  let fixture: ComponentFixture<GroupAdminDashboard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupAdminDashboard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupAdminDashboard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
