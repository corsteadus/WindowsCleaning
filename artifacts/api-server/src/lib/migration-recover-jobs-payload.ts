export const RECOVERY_ACTIVITY_LOG_FLAG = "recover_deleted_imported_jobs_v2_ran";

export interface RecoverySummary {
  restored: number;
  skipped: number;
  errors: number;
  uniqueJobs: number;
  totalScanned: number;
  beforeCount: number;
}

export interface RecoveryActivityLogPayload {
  entityType: "system";
  entityId: 0;
  action: typeof RECOVERY_ACTIVITY_LOG_FLAG;
  performedBy: "migration";
  note: string;
}

/**
 * Maps recovery metrics to the current activity_logs columns.
 *
 * The existing schema has no JSON metadata/details column. Keeping the
 * complete summary in note preserves observability without adding schema
 * surface or silently dropping the recovery context.
 */
export function buildRecoveryActivityLogPayload(
  summary: RecoverySummary,
): RecoveryActivityLogPayload {
  return {
    entityType: "system",
    entityId: 0,
    action: RECOVERY_ACTIVITY_LOG_FLAG,
    performedBy: "migration",
    note: [
      "Imported-job recovery summary",
      `restored=${summary.restored}`,
      `skipped=${summary.skipped}`,
      `errors=${summary.errors}`,
      `uniqueJobs=${summary.uniqueJobs}`,
      `totalScanned=${summary.totalScanned}`,
      `beforeCount=${summary.beforeCount}`,
    ].join("; "),
  };
}