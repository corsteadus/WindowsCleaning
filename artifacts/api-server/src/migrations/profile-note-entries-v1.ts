import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Dated, signed notes — profile redesign piece C (Kyle's answer, 2026-10-21:
 * "Specific and callback notes: each entry dated and signed; existing notes
 * preserved").
 *
 * Additive only. One new table; each profile's current specific and callback
 * text is copied in as its first entry, marked carried-over, dated when the
 * profile was last updated (the true date was never recorded) and signed by
 * nobody. The old columns are not touched.
 */
export const PROFILE_NOTE_ENTRIES_V1_ID = "profile-note-entries-v1";
const MANIFEST = [
  PROFILE_NOTE_ENTRIES_V1_ID,
  "add profile_note_entries; carry each profile's specific and callback text in as its first entry",
  "additive only; customers.specific_notes and customers.callback_notes are left as they are",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

const LEGACY = `
  SELECT id AS customer_id, 'specific' AS kind, specific_notes AS body, updated_at FROM customers
   WHERE NULLIF(btrim(specific_notes), '') IS NOT NULL
  UNION ALL
  SELECT id, 'callback', callback_notes, updated_at FROM customers
   WHERE NULLIF(btrim(callback_notes), '') IS NOT NULL`;

type Preflight = { existingTable: number; legacyNotes: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const tableExists = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name='profile_note_entries'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("Profile note entries migration is Sandbox-only");
  const existingTable = await tableExists(context);
  if (existingTable !== 0) throw new Error("profile_note_entries exists outside its migration ledger");
  return { existingTable, legacyNotes: await count(context, `SELECT COUNT(*)::int AS count FROM (${LEGACY}) legacy`) };
}

async function backup(context: MigrationContext, p: Preflight) {
  // Nothing is rewritten; the inventory proves what was carried over.
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('legacyNotes', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [PROFILE_NOTE_ENTRIES_V1_ID, p.legacyNotes]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}

async function apply(context: MigrationContext) {
  await context.client.query(`
    CREATE TABLE profile_note_entries (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('specific', 'callback')),
      body text NOT NULL CHECK (btrim(body) <> ''),
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text,
      created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
      carried_over boolean NOT NULL DEFAULT false,
      archived_at timestamptz,
      archived_by text);
    CREATE INDEX profile_note_entries_customer_idx ON profile_note_entries(customer_id, kind, created_at DESC);
  `);
  const carried = await context.client.query(`
    INSERT INTO profile_note_entries (customer_id, kind, body, created_at, carried_over)
    SELECT customer_id, kind, btrim(body), updated_at, true FROM (${LEGACY}) legacy`);
  return { createdTables: 1, carriedOver: carried.rowCount ?? 0, historicalRowsRewritten: 0 };
}

async function verify(context: MigrationContext) {
  if (await tableExists(context) !== 1) throw new Error("profile_note_entries is missing");
  // Every profile with old text has it as an entry. Counted this way so the
  // check still holds later, when new entries have been written beside them.
  const missing = await count(context, `SELECT COUNT(*)::int AS count FROM (${LEGACY}) legacy
    WHERE NOT EXISTS (SELECT 1 FROM profile_note_entries e
      WHERE e.customer_id = legacy.customer_id AND e.kind = legacy.kind AND e.carried_over)`);
  if (missing !== 0) throw new Error(`${missing} existing notes were not carried over`);
  return { missingCarryOvers: 0, historicalRowsRewritten: 0 };
}

async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [PROFILE_NOTE_ENTRIES_V1_ID]);
  if (backups !== 1) throw new Error("Profile note entries rollback requires its inventory backup");
  // The carried-over entries are copies of text still in customers; anything
  // written since exists nowhere else, so rolling back would lose it.
  const written = await count(context, "SELECT COUNT(*)::int AS count FROM profile_note_entries WHERE NOT carried_over");
  if (written !== 0) throw new Error(`${written} notes were written after the migration; rolling back would erase them`);
  await context.client.query("DROP TABLE IF EXISTS profile_note_entries");
  return { removedTables: 1, restoredRows: 0 };
}

export const profileNoteEntriesV1Migration: MigrationDefinition<Preflight> = {
  id: PROFILE_NOTE_ENTRIES_V1_ID, checksum,
  description: "Dated, signed specific and callback notes, with the existing text carried over",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
