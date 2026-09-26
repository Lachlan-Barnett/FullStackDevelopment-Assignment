import { ColourTheme } from './colour-theme';

export interface GroupMember {
  userId: number;
  role: 'admin' | 'member';
}

export interface Group {
  id: number;
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: ColourTheme;
  members: GroupMember[];
}
