import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * Sales tax — phase 6, Kyle's answer #2: optional and never on by default; state
 * and county rates set up by the business; a Taxable setting on each service.
 * Additive: one new table and columns that default to "no tax" — every service and
 * estimate line starts untaxed, every estimate has no rate, every job has 0 tax,
 * so no total anywhere changes.
 */
export const SALES_TAX_V1_ID = "sales-tax-v1";
const MANIFEST = [
  SALES_TAX_V1_ID,
  "create table tax_rates (kind state|county; state two letters; rate > 0 and <= 20)",
  "add services.taxable boolean not null default false",
  "add quote_line_items.taxable boolean not null default false",
  "add quotes.tax_rate numeric(7,4) null and quotes.tax_label text null",
  "add quotes.tax_state_rate_id and quotes.tax_county_rate_id (references tax_rates, set null)",
  "add jobs.tax_total numeric(10,2) not null default 0",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

const COLUMNS: ReadonlyArray<[table: string, column: string]> = [
  ["services", "taxable"], ["quote_line_items", "taxable"], ["quotes", "tax_rate"], ["quotes", "tax_label"],
  ["quotes", "tax_state_rate_id"], ["quotes", "tax_county_rate_id"], ["jobs", "tax_total"],
];

type Preflight = { existing: number; services: number; quotes: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name='tax_rates'`);
const columnCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.columns WHERE table_schema='public'
  AND (table_name, column_name) IN (${COLUMNS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`, COLUMNS.flat());

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existing = (await tableCount(context)) + (await columnCount(context));
  if (existing !== 0) throw new Error("A sales tax table or column exists outside its migration ledger");
  return {
    existing,
    services: await count(context, "SELECT COUNT(*)::int AS count FROM services"),
    quotes: await count(context, "SELECT COUNT(*)::int AS count FROM quotes"),
  };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('services', $2::int, 'quotes', $3::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [SALES_TAX_V1_ID, p.services, p.quotes]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`CREATE TABLE tax_rates (
    id serial PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL,
    state text NOT NULL,
    county text,
    rate numeric(7, 4) NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tax_rates_kind_check CHECK (kind IN ('state', 'county')),
    CONSTRAINT tax_rates_state_check CHECK (state ~ '^[A-Z]{2}$'),
    CONSTRAINT tax_rates_county_check CHECK (kind <> 'county' OR county IS NOT NULL),
    CONSTRAINT tax_rates_rate_check CHECK (rate > 0 AND rate <= 20)
  )`);
  await context.client.query("ALTER TABLE services ADD COLUMN taxable boolean NOT NULL DEFAULT false");
  await context.client.query("ALTER TABLE quote_line_items ADD COLUMN taxable boolean NOT NULL DEFAULT false");
  await context.client.query("ALTER TABLE quotes ADD COLUMN tax_rate numeric(7, 4)");
  await context.client.query("ALTER TABLE quotes ADD COLUMN tax_label text");
  await context.client.query("ALTER TABLE quotes ADD COLUMN tax_state_rate_id integer REFERENCES tax_rates(id) ON DELETE SET NULL");
  await context.client.query("ALTER TABLE quotes ADD COLUMN tax_county_rate_id integer REFERENCES tax_rates(id) ON DELETE SET NULL");
  await context.client.query("ALTER TABLE quotes ADD CONSTRAINT quotes_tax_rate_check CHECK (tax_rate IS NULL OR (tax_rate > 0 AND tax_rate <= 40))");
  await context.client.query("ALTER TABLE jobs ADD COLUMN tax_total numeric(10, 2) NOT NULL DEFAULT 0");
  return { addedTables: 1, addedColumns: COLUMNS.length, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await tableCount(context) !== 1) throw new Error("tax_rates is missing");
  if (await columnCount(context) !== COLUMNS.length) throw new Error("A sales tax column is missing");
  return { tables: 1, columns: COLUMNS.length, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [SALES_TAX_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("ALTER TABLE jobs DROP COLUMN IF EXISTS tax_total");
  await context.client.query("ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_tax_rate_check");
  await context.client.query("ALTER TABLE quotes DROP COLUMN IF EXISTS tax_county_rate_id");
  await context.client.query("ALTER TABLE quotes DROP COLUMN IF EXISTS tax_state_rate_id");
  await context.client.query("ALTER TABLE quotes DROP COLUMN IF EXISTS tax_label");
  await context.client.query("ALTER TABLE quotes DROP COLUMN IF EXISTS tax_rate");
  await context.client.query("ALTER TABLE quote_line_items DROP COLUMN IF EXISTS taxable");
  await context.client.query("ALTER TABLE services DROP COLUMN IF EXISTS taxable");
  await context.client.query("DROP TABLE IF EXISTS tax_rates");
  return { removedTables: 1, removedColumns: COLUMNS.length, restoredRows: 0 };
}

export const salesTaxV1Migration: MigrationDefinition<Preflight> = {
  id: SALES_TAX_V1_ID, checksum,
  description: "Sales tax rates, Taxable services and estimate tax",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
