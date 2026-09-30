import { ColourTheme } from './colour-theme';

export type RequestStatus = 'pending' | 'approved' | 'rejected';

// Fields shared by every kind of request a user can make.
interface BaseRequest {
  id: number;
  status: RequestStatus;
  rejectionReason: string | null;
  reviewedBy: number | null;
  createdAt: string;
}

export interface JoinRequest extends BaseRequest {
  groupId: number;
  userId: number;
  username?: string | null; // included when listed for a group admin
}

export interface GroupRequest extends BaseRequest {
  requestedBy: number;
  requesterName?: string | null; // included when listed for the super admin
  name: string;
  description: string;
  ageLimit: number;
  colourTheme: ColourTheme;
}

export interface RoomRequest extends BaseRequest {
  groupId: number;
  requestedBy: number;
  requesterName?: string | null; // included when listed for a group admin
  name: string;
  description: string;
}

// A group admin asking the super admin to delete their group.
export interface GroupDeleteRequest extends BaseRequest {
  groupId: number;
  groupName: string; // kept after the group is deleted
  requestedBy: number;
  requesterName?: string | null; // included when listed for the super admin
  reason: string;
}

// A group admin asking the super admin to remove a user from Fabulari (from a report).
export interface SystemBanRequest extends BaseRequest {
  userId: number;
  username: string; // kept after the account is deleted
  email: string;
  groupId: number;
  groupName: string;
  reportId: number;
  reason: string; // the report's reason
  requestedBy: number;
  requesterName?: string | null; // included when listed for the super admin
}
