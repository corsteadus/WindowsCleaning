import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Discounts — phase 5, Kyle's Video 5: named $ or % discounts that stack on an
 * estimate, and discounts kept on a profile (senior, military) that are added to
 * its new estimates; a job converted from a discounted estimate keeps its share
 * (jobs.discount_total). Additive: two new tables and one column defaulting to
 * 0; no row is rewritten — every estimate and job keeps its total.
 */
export const ESTIMATE_DISCOUNTS_V1_ID = "estimate-discounts-v1";
const MANIFEST = [
  ESTIMATE_DISCOUNTS_V1_ID,
  "create table customer_discounts (customer cascade; kind amount|percent; value > 0)",
  "create table quote_discounts (quote cascade; customer discount set null; kind amount|percent; value > 0; amount >= 0)",
  "add customer_discounts_customer_idx and quote_discounts_quote_idx",
  "add jobs.discount_total numeric(10,2) not null default 0",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingTables: number; existingColumn: number; quotes: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='discount_total'`);
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('customer_discounts', 'quote_discounts')`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingTables = await tableCount(context);
  if (existingTables !== 0) throw new Error("A discounts table exists outside its migration ledger");
  const existingColumn = await columnCount(context);
  if (existingColumn !== 0) throw new Error("jobs.discount_total exists outside its migration ledger");
  return { existingTables, existingColumn, quotes: await count(context, "SELECT COUNT(*)::int AS count FROM quotes") };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('quotes', $2::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [ESTIMATE_DISCOUNTS_V1_ID, p.quotes]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`CREATE TABLE customer_discounts (
    id serial PRIMARY KEY,
    customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text NOT NULL,
    value numeric(10, 2) NOT NULL,
    archived_at timestamptz,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_discounts_kind_check CHECK (kind IN ('amount', 'percent')),
    CONSTRAINT customer_discounts_value_check CHECK (value > 0 AND (kind <> 'percent' OR value <= 100))
  )`);
  await context.client.query(`CREATE TABLE quote_discounts (
    id serial PRIMARY KEY,
    quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text NOT NULL,
    value numeric(10, 2) NOT NULL,
    amount numeric(10, 2) NOT NULL DEFAULT 0,
    sort_order integer NOT NULL DEFAULT 0,
    customer_discount_id integer REFERENCES customer_discounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT quote_discounts_kind_check CHECK (kind IN ('amount', 'percent')),
    CONSTRAINT quote_discounts_value_check CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
    CONSTRAINT quote_discounts_amount_check CHECK (amount >= 0)
  )`);
  await context.client.query("CREATE INDEX customer_discounts_customer_idx ON customer_discounts (customer_id)");
  await context.client.query("CREATE INDEX quote_discounts_quote_idx ON quote_discounts (quote_id)");
  await context.client.query("ALTER TABLE jobs ADD COLUMN discount_total numeric(10, 2) NOT NULL DEFAULT 0");
  return { addedTables: 2, addedIndexes: 2, addedColumns: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await tableCount(context) !== 2) throw new Error("A discounts table is missing");
  if (await columnCount(context) !== 1) throw new Error("jobs.discount_total is missing");
  return { tables: 2, columns: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [ESTIMATE_DISCOUNTS_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("ALTER TABLE jobs DROP COLUMN IF EXISTS discount_total");
  await context.client.query("DROP TABLE IF EXISTS quote_discounts");
  await context.client.query("DROP TABLE IF EXISTS customer_discounts");
  return { removedTables: 2, removedColumns: 1, restoredRows: 0 };
}

export const estimateDiscountsV1Migration: MigrationDefinition<Preflight> = {
  id: ESTIMATE_DISCOUNTS_V1_ID, checksum,
  description: "Discounts on estimates, and on profiles",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
