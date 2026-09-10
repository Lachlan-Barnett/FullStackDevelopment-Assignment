import { Routes } from '@angular/router';
import { Login } from './login/login';
import { Signup } from './signup/signup';
import { Chat } from './chat/chat';
import { Settings } from './settings/settings';
import { ChangePassword } from './change-password/change-password';
import { ChangeUsername } from './change-username/change-username';
import { ChangeBirthdate } from './change-birthdate/change-birthdate';
import { Report } from './report/report';
import { Groups } from './groups/groups';
import { GroupAdminDashboard } from './group-admin-dashboard/group-admin-dashboard';
import { SuperAdminDashboard } from './super-admin-dashboard/super-admin-dashboard';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';
import { superAdminGuard } from './guards/super-admin.guard';

export const routes: Routes = [
    { path: '', component: Login, title: 'Login', canActivate: [guestGuard] },
    { path: 'signup', component: Signup, title: 'Sign Up', canActivate: [guestGuard] },
    { path: 'chat', component: Chat, title: 'Chat', canActivate: [authGuard] },
    { path: 'settings', component: Settings, title: 'Settings', canActivate: [authGuard] },
    { path: 'change-password', component: ChangePassword, title: 'Change Password', canActivate: [authGuard] },
    { path: 'change-username', component: ChangeUsername, title: 'Change Username', canActivate: [authGuard] },
    { path: 'change-birthdate', component: ChangeBirthdate, title: 'Change Birthdate', canActivate: [authGuard] },
    { path: 'report', component: Report, title: 'Report', canActivate: [authGuard] },
    { path: 'groups', component: Groups, title: 'Groups', canActivate: [authGuard] },
    { path: 'admin/group/:groupId', component: GroupAdminDashboard, title: 'Group Admin', canActivate: [authGuard] },
    { path: 'admin/super', component: SuperAdminDashboard, title: 'Super Admin', canActivate: [authGuard, superAdminGuard] },
];