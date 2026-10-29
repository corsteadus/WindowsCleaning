import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * A4 — scheduling an accepted estimate with an arrival window (Video 7): "we'll
 * arrive between 9 and 11" instead of an exact time. One nullable column on
 * jobs; null keeps every existing job an exact-time job. Additive.
 */
export const JOB_ARRIVAL_WINDOW_V1_ID = "job-arrival-window-v1";
const MANIFEST = [
  JOB_ARRIVAL_WINDOW_V1_ID,
  "alter table jobs add arrival_window_minutes integer null",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingColumns: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='arrival_window_minutes'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumns = await columnCount(context);
  if (existingColumns !== 0) throw new Error("jobs.arrival_window_minutes exists outside its migration ledger");
  return { existingColumns };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('columns', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [JOB_ARRIVAL_WINDOW_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query("ALTER TABLE jobs ADD COLUMN arrival_window_minutes integer");
  return { addedColumns: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 1) throw new Error("jobs.arrival_window_minutes is missing");
  return { columns: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [JOB_ARRIVAL_WINDOW_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("ALTER TABLE jobs DROP COLUMN IF EXISTS arrival_window_minutes");
  return { removedColumns: 1, restoredRows: 0 };
}

export const jobArrivalWindowV1Migration: MigrationDefinition<Preflight> = {
  id: JOB_ARRIVAL_WINDOW_V1_ID, checksum,
  description: "A job's arrival window (the customer is told a window, not an exact time)",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
