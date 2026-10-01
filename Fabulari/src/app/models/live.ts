import { PresentUser } from './message';

// What the server says changed, so open pages can reload it straight away (the "refresh" socket event).
// "groups": the user's groups or memberships, "rooms": a group's rooms, "requests": the user's requests,
// "group-admin": a group admin dashboard (with its groupId), "super-admin": the super admin dashboard.
export type RefreshScope = 'groups' | 'rooms' | 'requests' | 'group-admin' | 'super-admin';

export interface RefreshEvent {
  scope: RefreshScope;
  groupId?: number;
}

// Someone started or stopped typing in a room (the "typing" socket event).
export interface TypingEvent {
  roomId: number;
  user: PresentUser;
  typing: boolean;
}
