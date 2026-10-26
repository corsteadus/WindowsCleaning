import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Callbacks — phase 4, Kyle's Video 4: a list of prospects and customers to call,
 * and for each call whether they spoke, left a message or neither, and when to
 * call next. Additive: one new table; nothing existing is touched.
 */
export const PROFILE_CALLBACKS_V1_ID = "profile-callbacks-v1";
const MANIFEST = [
  PROFILE_CALLBACKS_V1_ID,
  "create table profile_callbacks (customer cascade, assigned user set null)",
  "add profile_callbacks_customer_idx and profile_callbacks_open_due_idx",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingTable: number; profiles: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name='profile_callbacks'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingTable = await tableCount(context);
  if (existingTable !== 0) throw new Error("profile_callbacks exists outside its migration ledger");
  return { existingTable, profiles: await count(context, "SELECT COUNT(*)::int AS count FROM customers") };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('profiles', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [PROFILE_CALLBACKS_V1_ID, p.profiles]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`CREATE TABLE profile_callbacks (
    id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    due_at timestamptz NOT NULL,
    assigned_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    reason text,
    status text NOT NULL DEFAULT 'open',
    outcome text,
    outcome_note text,
    completed_at timestamptz,
    completed_by text,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_callbacks_status_check CHECK (status IN ('open', 'done', 'cancelled')),
    CONSTRAINT profile_callbacks_outcome_check CHECK (outcome IS NULL OR outcome IN ('spoke', 'left_message', 'no_answer'))
  )`);
  await context.client.query("CREATE INDEX profile_callbacks_customer_idx ON profile_callbacks (customer_id)");
  await context.client.query("CREATE INDEX profile_callbacks_open_due_idx ON profile_callbacks (status, due_at)");
  return { addedTables: 1, addedIndexes: 2, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await tableCount(context) !== 1) throw new Error("profile_callbacks is missing");
  return { tables: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [PROFILE_CALLBACKS_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("DROP TABLE IF EXISTS profile_callbacks");
  return { removedTables: 1, restoredRows: 0 };
}

export const profileCallbacksV1Migration: MigrationDefinition<Preflight> = {
  id: PROFILE_CALLBACKS_V1_ID, checksum,
  description: "Callbacks to prospects and customers",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
