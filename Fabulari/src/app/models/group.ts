import { ColourTheme } from './colour-theme';

export interface GroupMember {
  userId: number;
  role: 'admin' | 'member';
}

// A member as returned by GET /groups/:groupId/members, with their display name.
export interface GroupMemberDetails extends GroupMember {
  username: string | null;
}

export interface Group {
  id: number;
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: ColourTheme;
  members: GroupMember[];
  isBanned?: boolean; // whether the logged-in user is banned from this group (who else is banned stays private)
}

// Someone banned from a group, as shown to that group's admins (GET /groups/:groupId/banned).
export interface BannedMember {
  userId: number;
  username: string | null; // null if the account has since been removed from Fabulari
  bannedAt: string;
  bannedByName: string | null;
  reason: string | null; // the report the ban came from
}
