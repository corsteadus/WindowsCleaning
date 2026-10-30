import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * A5 — templates for every way the office writes to a profile (Video 8): an
 * email, a text, a printed letter. The existing email_templates table gains a
 * channel (every existing row stays an email template) and who saved it last.
 * Additive: two nullable-or-defaulted columns, a check and an index.
 */
export const MESSAGE_TEMPLATES_V1_ID = "message-templates-v1";
const MANIFEST = [
  MESSAGE_TEMPLATES_V1_ID,
  "alter table email_templates add channel text not null default 'email' check in (email, sms, letter)",
  "alter table email_templates add created_by text null, updated_by text null",
  "create index email_templates_channel_name_idx on email_templates (channel, name)",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingColumns: number; templates: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='email_templates'
  AND column_name IN ('channel','created_by','updated_by')`);
const indexCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM pg_indexes WHERE schemaname='public' AND indexname='email_templates_channel_name_idx'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumns = await columnCount(context);
  if (existingColumns !== 0) throw new Error("email_templates channel columns exist outside their migration ledger");
  const templates = await count(context, "SELECT COUNT(*)::int AS count FROM email_templates");
  return { existingColumns, templates };
}
async function backup(context: MigrationContext, preflightResult: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('columns', 0, 'templates', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [MESSAGE_TEMPLATES_V1_ID, preflightResult.templates]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`ALTER TABLE email_templates
    ADD COLUMN channel text NOT NULL DEFAULT 'email',
    ADD COLUMN created_by text,
    ADD COLUMN updated_by text`);
  await context.client.query(`ALTER TABLE email_templates ADD CONSTRAINT email_templates_channel_check
    CHECK (channel IN ('email','sms','letter'))`);
  await context.client.query("CREATE INDEX email_templates_channel_name_idx ON email_templates (channel, name)");
  return { addedColumns: 3, addedIndexes: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 3) throw new Error("email_templates channel columns are missing");
  if (await indexCount(context) !== 1) throw new Error("email_templates_channel_name_idx is missing");
  const notEmail = await count(context, "SELECT COUNT(*)::int AS count FROM email_templates WHERE channel <> 'email'");
  return { columns: 3, indexes: 1, existingTemplatesStillEmail: notEmail === 0, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [MESSAGE_TEMPLATES_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  // Text and letter templates cannot live in an email-only table.
  await context.client.query("DELETE FROM email_templates WHERE channel <> 'email'");
  await context.client.query("DROP INDEX IF EXISTS email_templates_channel_name_idx");
  await context.client.query(`ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_channel_check,
    DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS updated_by`);
  return { removedColumns: 3, restoredRows: 0 };
}

export const messageTemplatesV1Migration: MigrationDefinition<Preflight> = {
  id: MESSAGE_TEMPLATES_V1_ID, checksum,
  description: "Email, text and letter templates in one store (the channel of each template)",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
