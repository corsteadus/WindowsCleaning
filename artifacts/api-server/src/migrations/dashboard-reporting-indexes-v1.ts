import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations.ts";

const INDEXES = [
  "estimate_public_links_decision_at_idx",
  "estimate_activities_type_time_idx",
  "idx_jobs_created_at",
] as const;

export const DASHBOARD_REPORTING_INDEXES_V1_ID = "dashboard-reporting-indexes-v1";
export const DASHBOARD_REPORTING_INDEXES_V1_CHECKSUM = createHash("sha256")
  .update(`${DASHBOARD_REPORTING_INDEXES_V1_ID}\n${INDEXES.join("\n")}`)
  .digest("hex");

async function indexCount(context: MigrationContext): Promise<number> {
  const result = await context.client.query(
    `SELECT COUNT(*)::int AS count FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`,
    [INDEXES],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export const dashboardReportingIndexesV1Migration: MigrationDefinition<{ existing: number }> = {
  id: DASHBOARD_REPORTING_INDEXES_V1_ID,
  checksum: DASHBOARD_REPORTING_INDEXES_V1_CHECKSUM,
  description: "Add non-destructive date indexes for period-aware dashboard reporting",
  required: true,
  preflight: async (context) => ({ existing: await indexCount(context) }),
  backup: async (_context, preflight) => ({ existingIndexes: preflight.existing, dataRowsBackedUp: 0 }),
  apply: async (context) => {
    await context.client.query("CREATE INDEX IF NOT EXISTS estimate_public_links_decision_at_idx ON estimate_public_links(decision_at)");
    await context.client.query("CREATE INDEX IF NOT EXISTS estimate_activities_type_time_idx ON estimate_activities(activity_type, occurred_at)");
    await context.client.query("CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at)");
    return { createdIndexes: INDEXES.length };
  },
  postflight: async (context) => {
    const present = await indexCount(context);
    if (present !== INDEXES.length) throw new Error("Dashboard reporting indexes are incomplete");
    return { presentIndexes: present, dataRowsChanged: 0 };
  },
  verify: async (context) => {
    const present = await indexCount(context);
    if (present !== INDEXES.length) throw new Error("Dashboard reporting indexes are incomplete");
    return { presentIndexes: present };
  },
  rollback: async (context) => {
    for (const index of INDEXES) await context.client.query(`DROP INDEX IF EXISTS ${index}`);
    return { removedIndexes: INDEXES.length, dataRowsChanged: 0 };
  },
};