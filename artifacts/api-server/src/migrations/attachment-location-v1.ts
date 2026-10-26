import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Which location a photo or file belongs to — phase 3, Kyle's Videos 4 and 5:
 * photos, documents and videos "organised by job location". Additive: one
 * nullable column; files uploaded before it belong to the profile as a whole.
 * Deleting a location keeps its files — they fall back to the whole profile.
 */
export const ATTACHMENT_LOCATION_V1_ID = "attachment-location-v1";
const MANIFEST = [
  ATTACHMENT_LOCATION_V1_ID,
  "add attachments.property_id (nullable integer, references properties on delete set null)",
  "add attachments_property_id_idx",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingColumn: number; attachments: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='attachments' AND column_name='property_id'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumn = await columnCount(context);
  if (existingColumn !== 0) throw new Error("attachments.property_id exists outside its migration ledger");
  return { existingColumn, attachments: await count(context, "SELECT COUNT(*)::int AS count FROM attachments") };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('attachments', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [ATTACHMENT_LOCATION_V1_ID, p.attachments]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query("ALTER TABLE attachments ADD COLUMN property_id integer REFERENCES properties(id) ON DELETE SET NULL");
  await context.client.query("CREATE INDEX IF NOT EXISTS attachments_property_id_idx ON attachments (property_id)");
  return { addedColumns: 1, addedIndexes: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 1) throw new Error("attachments.property_id is missing");
  return { columns: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [ATTACHMENT_LOCATION_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("DROP INDEX IF EXISTS attachments_property_id_idx");
  await context.client.query("ALTER TABLE attachments DROP COLUMN IF EXISTS property_id");
  return { removedColumns: 1, restoredRows: 0 };
}

export const attachmentLocationV1Migration: MigrationDefinition<Preflight> = {
  id: ATTACHMENT_LOCATION_V1_ID, checksum,
  description: "File photos and documents by location",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
