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
  colourTheme: string;
}

export interface RoomRequest extends BaseRequest {
  groupId: number;
  requestedBy: number;
  requesterName?: string | null; // included when listed for a group admin
  name: string;
  description: string;
}
