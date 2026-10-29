import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * The customer's decision done right — Videos 7 and 9. What a customer writes
 * when accepting is kept on the estimate as its Customer Notes (Kyle: a
 * must-have), and the business words the thank-you it shows and emails.
 * Additive: six nullable or defaulted columns; no row is rewritten.
 */
export const ESTIMATE_ACCEPTANCE_V1_ID = "estimate-acceptance-v1";
const MANIFEST = [
  ESTIMATE_ACCEPTANCE_V1_ID,
  "alter table quotes add customer_notes text (<= 2000), customer_notes_at timestamptz",
  "alter table quote_settings add acceptance_message text (<= 4000), acceptance_email_enabled boolean default true, acceptance_email_subject text (<= 300), acceptance_email_body text (<= 10000)",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

const COLUMNS: ReadonlyArray<[string, string]> = [
  ["quotes", "customer_notes"], ["quotes", "customer_notes_at"],
  ["quote_settings", "acceptance_message"], ["quote_settings", "acceptance_email_enabled"],
  ["quote_settings", "acceptance_email_subject"], ["quote_settings", "acceptance_email_body"],
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

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumns = await columnCount(context);
  if (existingColumns !== 0) throw new Error("estimate acceptance columns exist outside their migration ledger");
  return { existingColumns };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('columns', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [ESTIMATE_ACCEPTANCE_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`ALTER TABLE quotes
    ADD COLUMN customer_notes text,
    ADD COLUMN customer_notes_at timestamptz,
    ADD CONSTRAINT quotes_customer_notes_length_check CHECK (customer_notes IS NULL OR length(customer_notes) <= 2000)`);
  await context.client.query(`ALTER TABLE quote_settings
    ADD COLUMN acceptance_message text,
    ADD COLUMN acceptance_email_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN acceptance_email_subject text,
    ADD COLUMN acceptance_email_body text,
    ADD CONSTRAINT quote_settings_acceptance_length_check CHECK (
      (acceptance_message IS NULL OR length(acceptance_message) <= 4000)
      AND (acceptance_email_subject IS NULL OR length(acceptance_email_subject) <= 300)
      AND (acceptance_email_body IS NULL OR length(acceptance_email_body) <= 10000))`);
  return { addedColumns: COLUMNS.length, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== COLUMNS.length) throw new Error("estimate acceptance columns are missing");
  return { columns: COLUMNS.length, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [ESTIMATE_ACCEPTANCE_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query(`ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_customer_notes_length_check,
    DROP COLUMN IF EXISTS customer_notes, DROP COLUMN IF EXISTS customer_notes_at`);
  await context.client.query(`ALTER TABLE quote_settings DROP CONSTRAINT IF EXISTS quote_settings_acceptance_length_check,
    DROP COLUMN IF EXISTS acceptance_message, DROP COLUMN IF EXISTS acceptance_email_enabled,
    DROP COLUMN IF EXISTS acceptance_email_subject, DROP COLUMN IF EXISTS acceptance_email_body`);
  return { removedColumns: COLUMNS.length, restoredRows: 0 };
}

export const estimateAcceptanceV1Migration: MigrationDefinition<Preflight> = {
  id: ESTIMATE_ACCEPTANCE_V1_ID, checksum,
  description: "Customer Notes on estimates, and the business's own thank-you after acceptance",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
