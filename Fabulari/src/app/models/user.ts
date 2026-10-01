export interface User {
  id: number;
  email: string;
  username: string;
  birthdate: string;
  role: 'user' | 'superadmin';
  profilePhoto?: string | null; // server path, e.g. /uploads/avatars/2.png?v=...
  darkMode?: boolean; // the display setting, saved on the account
}

// An account the super admin permanently removed from Fabulari. Its email can never sign up again.
export interface RemovedUser {
  userId: number;
  username: string | null;
  email: string;
  removedAt: string;
  groupName: string | null; // the group the removal was requested from
  reason: string | null; // the report's reason
  requestedBy: number | null;
  requesterName: string | null; // the group admin who asked
}
