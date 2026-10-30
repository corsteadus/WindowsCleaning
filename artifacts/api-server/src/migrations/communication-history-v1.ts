import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * A6 — one communication history on the profile (Video 8): every email, text
 * and letter in one list, each openable, and removable by the owner or an admin.
 * Two new tables (printed letters; the history's deletions, which hide an entry
 * and record who removed it) and the record an email was about. Additive.
 */
export const COMMUNICATION_HISTORY_V1_ID = "communication-history-v1";
const MANIFEST = [
  COMMUNICATION_HISTORY_V1_ID,
  "alter table email_logs add related_type text null, related_id integer null",
  "create table printed_letters (customer fk cascade, template, subject, body, recipient_lines jsonb, printed_by, printed_at) + index (customer_id, printed_at)",
  "create table communication_deletions (customer fk cascade, source check email|message|delivery|letter, source_id, summary, deleted_by, deleted_by_user_id, deleted_at) + unique (source, source_id) + index (customer_id)",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existing: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='email_logs'
  AND column_name IN ('related_type','related_id')`);
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('printed_letters','communication_deletions')`);
const indexCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM pg_indexes WHERE schemaname='public' AND indexname IN
  ('printed_letters_customer_idx','communication_deletions_source_uq','communication_deletions_customer_idx')`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existing = await columnCount(context) + await tableCount(context);
  if (existing !== 0) throw new Error("communication history objects exist outside their migration ledger");
  return { existing };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('columns', 0, 'tables', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [COMMUNICATION_HISTORY_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query("ALTER TABLE email_logs ADD COLUMN related_type text, ADD COLUMN related_id integer");
  await context.client.query(`CREATE TABLE printed_letters (
    id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    template_id integer,
    template_name text,
    subject text,
    body text NOT NULL,
    recipient_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    printed_by text,
    printed_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query("CREATE INDEX printed_letters_customer_idx ON printed_letters (customer_id, printed_at)");
  await context.client.query(`CREATE TABLE communication_deletions (
    id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('email','message','delivery','letter')),
    source_id integer NOT NULL,
    summary text,
    deleted_by text,
    deleted_by_user_id text,
    deleted_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query("CREATE UNIQUE INDEX communication_deletions_source_uq ON communication_deletions (source, source_id)");
  await context.client.query("CREATE INDEX communication_deletions_customer_idx ON communication_deletions (customer_id)");
  return { addedColumns: 2, addedTables: 2, addedIndexes: 3, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 2) throw new Error("email_logs related columns are missing");
  if (await tableCount(context) !== 2) throw new Error("printed_letters or communication_deletions is missing");
  if (await indexCount(context) !== 3) throw new Error("a communication history index is missing");
  return { columns: 2, tables: 2, indexes: 3, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [COMMUNICATION_HISTORY_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("DROP TABLE IF EXISTS communication_deletions");
  await context.client.query("DROP TABLE IF EXISTS printed_letters");
  await context.client.query("ALTER TABLE email_logs DROP COLUMN IF EXISTS related_type, DROP COLUMN IF EXISTS related_id");
  return { removedColumns: 2, removedTables: 2, restoredRows: 0 };
}

export const communicationHistoryV1Migration: MigrationDefinition<Preflight> = {
  id: COMMUNICATION_HISTORY_V1_ID, checksum,
  description: "One communication history: printed letters, deletions by the owner or an admin, and what an email was about",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
