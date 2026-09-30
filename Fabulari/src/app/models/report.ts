export interface Report {
  id: number;
  reportedUserId: number;
  reportedBy: number;
  groupId: number;
  reason: string;
  status: 'pending' | 'actioned' | 'dismissed'; // actioned = the user was banned
  reviewedBy?: number | null;
  createdAt: string;
  // Included when listed for a group admin.
  reporterName?: string | null;
  reportedName?: string | null;
}
