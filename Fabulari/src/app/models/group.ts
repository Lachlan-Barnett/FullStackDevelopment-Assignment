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
}
