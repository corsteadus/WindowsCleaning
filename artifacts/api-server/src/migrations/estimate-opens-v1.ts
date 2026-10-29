import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Opens tracked and notified — Video 7. Each address an estimate is emailed to
 * gets its own open key in its link, so the office sees which address opened it
 * and how often; the office is emailed on an address's first open and then at
 * most daily. Opens of a link with no key (copied by hand) are counted on the
 * link. Additive: nullable or defaulted columns and one partial unique index.
 */
export const ESTIMATE_OPENS_V1_ID = "estimate-opens-v1";
const MANIFEST = [
  ESTIMATE_OPENS_V1_ID,
  "alter table estimate_delivery_requests add open_key_hash text, open_count integer default 0, first_opened_at timestamptz, last_opened_at timestamptz, open_notified_at timestamptz",
  "create unique index estimate_delivery_requests_open_key_idx on estimate_delivery_requests (open_key_hash) where open_key_hash is not null",
  "alter table estimate_public_links add open_count integer default 0, open_notified_at timestamptz",
  "alter table quote_settings add open_notification_enabled boolean default true",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

const COLUMNS: ReadonlyArray<[string, string]> = [
  ["estimate_delivery_requests", "open_key_hash"], ["estimate_delivery_requests", "open_count"],
  ["estimate_delivery_requests", "first_opened_at"], ["estimate_delivery_requests", "last_opened_at"],
  ["estimate_delivery_requests", "open_notified_at"],
  ["estimate_public_links", "open_count"], ["estimate_public_links", "open_notified_at"],
  ["quote_settings", "open_notification_enabled"],
];

type Preflight = { existingColumns: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public'
  AND (table_name, column_name) IN (${COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`, COLUMNS.flat());
const indexCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count FROM pg_indexes
  WHERE schemaname='public' AND indexname='estimate_delivery_requests_open_key_idx'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumns = await columnCount(context);
  if (existingColumns !== 0 || await indexCount(context) !== 0) {
    throw new Error("estimate open-tracking columns exist outside their migration ledger");
  }
  return { existingColumns };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('columns', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [ESTIMATE_OPENS_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`ALTER TABLE estimate_delivery_requests
    ADD COLUMN open_key_hash text,
    ADD COLUMN open_count integer NOT NULL DEFAULT 0,
    ADD COLUMN first_opened_at timestamptz,
    ADD COLUMN last_opened_at timestamptz,
    ADD COLUMN open_notified_at timestamptz`);
  await context.client.query(`CREATE UNIQUE INDEX estimate_delivery_requests_open_key_idx
    ON estimate_delivery_requests (open_key_hash) WHERE open_key_hash IS NOT NULL`);
  await context.client.query(`ALTER TABLE estimate_public_links
    ADD COLUMN open_count integer NOT NULL DEFAULT 0,
    ADD COLUMN open_notified_at timestamptz`);
  await context.client.query(`ALTER TABLE quote_settings
    ADD COLUMN open_notification_enabled boolean NOT NULL DEFAULT true`);
  return { addedColumns: COLUMNS.length, addedIndexes: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== COLUMNS.length) throw new Error("estimate open-tracking columns are missing");
  if (await indexCount(context) !== 1) throw new Error("estimate open-key index is missing");
  return { columns: COLUMNS.length, indexes: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [ESTIMATE_OPENS_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("DROP INDEX IF EXISTS estimate_delivery_requests_open_key_idx");
  await context.client.query(`ALTER TABLE estimate_delivery_requests
    DROP COLUMN IF EXISTS open_key_hash, DROP COLUMN IF EXISTS open_count, DROP COLUMN IF EXISTS first_opened_at,
    DROP COLUMN IF EXISTS last_opened_at, DROP COLUMN IF EXISTS open_notified_at`);
  await context.client.query(`ALTER TABLE estimate_public_links
    DROP COLUMN IF EXISTS open_count, DROP COLUMN IF EXISTS open_notified_at`);
  await context.client.query("ALTER TABLE quote_settings DROP COLUMN IF EXISTS open_notification_enabled");
  return { removedColumns: COLUMNS.length, removedIndexes: 1, restoredRows: 0 };
}

export const estimateOpensV1Migration: MigrationDefinition<Preflight> = {
  id: ESTIMATE_OPENS_V1_ID, checksum,
  description: "Which address opened an estimate, how often, and the office told when it is opened",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
