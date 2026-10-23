import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Kyle's answers of 2026-10-24, as two additive columns.
 *
 * 1. "Blank price: the service has not been priced yet, so the estimate cannot
 *    be sent. $0.00: this is a valid price." Both were stored as 0, so a line
 *    now says which it is: `quote_line_items.price_pending`. Existing lines are
 *    left as priced — nothing recorded which zeros were blanks.
 *
 * 2. "Archived and Deactivated should mean the same thing … It can be
 *    reactivated and returned to the active list", with prospects and
 *    customers kept as separate lists. Nothing recorded which list a
 *    deactivated profile came from, so reactivating a prospect made it a
 *    customer. `customers.deactivated_from` holds it; profiles already
 *    deactivated get it from whether they ever became a customer (a customer
 *    since date), which is the only evidence there is.
 */
export const KYLE_ANSWERS_2026_10_24_V1_ID = "kyle-answers-2026-10-24-v1";
const MANIFEST = [
  KYLE_ANSWERS_2026_10_24_V1_ID,
  "add quote_line_items.price_pending (default false); add customers.deactivated_from",
  "fill deactivated_from for profiles already inactive or archived, from customer_date; nothing else rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingColumns: number; deactivated: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public'
   AND ((table_name='quote_line_items' AND column_name='price_pending')
     OR (table_name='customers' AND column_name='deactivated_from'))`);
const DEACTIVATED = "lifecycle_status IN ('inactive', 'archived')";

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingColumns = await columnCount(context);
  if (existingColumns !== 0) throw new Error("price_pending or deactivated_from exists outside its migration ledger");
  return { existingColumns, deactivated: await count(context, `SELECT COUNT(*)::int AS count FROM customers WHERE ${DEACTIVATED}`) };
}

async function backup(context: MigrationContext, p: Preflight) {
  // The only rows written are the deactivated profiles; their ids are kept.
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    SELECT $1, 'inventory', jsonb_build_object(
      'deactivated', $2::int,
      'deactivatedIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM customers WHERE ${DEACTIVATED}), '[]'::jsonb))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [KYLE_ANSWERS_2026_10_24_V1_ID, p.deactivated]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}

async function apply(context: MigrationContext) {
  await context.client.query(`
    ALTER TABLE quote_line_items ADD COLUMN price_pending boolean NOT NULL DEFAULT false;
    ALTER TABLE customers ADD COLUMN deactivated_from text
      CHECK (deactivated_from IN ('prospect', 'customer'));
  `);
  const filled = await context.client.query(`UPDATE customers
    SET deactivated_from = CASE WHEN customer_date IS NULL THEN 'prospect' ELSE 'customer' END
    WHERE ${DEACTIVATED}`);
  return { addedColumns: 2, deactivatedFilled: filled.rowCount ?? 0, historicalRowsRewritten: 0 };
}

async function verify(context: MigrationContext) {
  if (await columnCount(context) !== 2) throw new Error("price_pending or deactivated_from is missing");
  const unfilled = await count(context, `SELECT COUNT(*)::int AS count FROM customers
    WHERE ${DEACTIVATED} AND deactivated_from IS NULL`);
  if (unfilled !== 0) throw new Error(`${unfilled} deactivated profiles do not say which list they belong to`);
  return { unfilled: 0, historicalRowsRewritten: 0 };
}

async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [KYLE_ANSWERS_2026_10_24_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  // A pending price would turn back into a sendable $0, so refuse while one exists.
  const pending = await count(context, "SELECT COUNT(*)::int AS count FROM quote_line_items WHERE price_pending");
  if (pending !== 0) throw new Error(`${pending} lines are still to be quoted; rolling back would make them sendable at $0`);
  await context.client.query(`
    ALTER TABLE quote_line_items DROP COLUMN IF EXISTS price_pending;
    ALTER TABLE customers DROP COLUMN IF EXISTS deactivated_from;
  `);
  return { removedColumns: 2, restoredRows: 0 };
}

export const kyleAnswers20261024V1Migration: MigrationDefinition<Preflight> = {
  id: KYLE_ANSWERS_2026_10_24_V1_ID, checksum,
  description: "A line can be still to be quoted; a deactivated profile remembers its list",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
