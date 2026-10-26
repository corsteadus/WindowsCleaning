import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Who sent an email — phase 2, Kyle's Video 4: "you can see the date and time,
 * what we emailed, and who sent the email." `email_logs` kept everything but
 * the sender. Additive: one nullable column; emails sent before it say nobody.
 */
export const EMAIL_LOG_SENDER_V1_ID = "email-log-sender-v1";
const MANIFEST = [
  EMAIL_LOG_SENDER_V1_ID,
  "add email_logs.sent_by (nullable text)",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingColumn: number; emails: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='email_logs' AND column_name='sent_by'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumn = await columnCount(context);
  if (existingColumn !== 0) throw new Error("email_logs.sent_by exists outside its migration ledger");
  return { existingColumn, emails: await count(context, "SELECT COUNT(*)::int AS count FROM email_logs") };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('emails', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [EMAIL_LOG_SENDER_V1_ID, p.emails]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query("ALTER TABLE email_logs ADD COLUMN sent_by text");
  return { addedColumns: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 1) throw new Error("email_logs.sent_by is missing");
  return { columns: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [EMAIL_LOG_SENDER_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("ALTER TABLE email_logs DROP COLUMN IF EXISTS sent_by");
  return { removedColumns: 1, restoredRows: 0 };
}

export const emailLogSenderV1Migration: MigrationDefinition<Preflight> = {
  id: EMAIL_LOG_SENDER_V1_ID, checksum,
  description: "Record who sent each email",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
