// One entry in the super admin's audit log (GET /admin/audit-log).
export interface AuditLogEntry {
  id: number;
  type: string; // e.g. "GROUP_CREATED", "USER_BANNED_FROM_GROUP"
  actorId: number | null;
  actorName: string | null; // stored with the entry, so it survives the account being deleted
  targetType: string | null;
  targetId: number | null;
  details: string;
  timestamp: string;
}

// One page of the audit log, with every type seen so far (for the filter) and how many entries match.
export interface AuditLogPage {
  types: string[];
  entries: AuditLogEntry[];
  total: number;
}
