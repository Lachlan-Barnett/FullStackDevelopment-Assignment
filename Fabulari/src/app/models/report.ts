export interface Report {
  id: number;
  reportedUserId: number;
  reportedBy: number;
  groupId: number;
  reason: string;
  status: 'pending' | 'actioned' | 'dismissed';
  createdAt: string;
}
