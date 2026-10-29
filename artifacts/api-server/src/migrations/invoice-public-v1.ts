import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * A3 — the customer's invoice page, its PDF and its opens (Video 7). Three new
 * tables: the invoice's secret links (only a hash of each is kept), each address
 * it was emailed to with its own open key, and the invoice's history. Additive:
 * no existing table or row is touched.
 */
export const INVOICE_PUBLIC_V1_ID = "invoice-public-v1";
const MANIFEST = [
  INVOICE_PUBLIC_V1_ID,
  "create table invoice_public_links (id, invoice_id, token_hash unique, created_by, first_opened_at, last_activity_at, open_count default 0, open_notified_at, created_at)",
  "create table invoice_deliveries (id, invoice_id, public_link_id, channel, recipient, status, last_error, requested_by, requested_at, open_key_hash unique, open_count default 0, first_opened_at, last_opened_at, open_notified_at)",
  "create table invoice_activities (id, invoice_id, public_link_id, activity_type, detail jsonb, actor_type, actor_id, occurred_at)",
  "additive only; no existing row is touched",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

const TABLES = ["invoice_public_links", "invoice_deliveries", "invoice_activities"] as const;
const INDEXES = [
  "invoice_public_links_token_hash_idx", "invoice_public_links_invoice_idx",
  "invoice_deliveries_invoice_idx", "invoice_deliveries_open_key_idx", "invoice_activities_invoice_time_idx",
] as const;

type Preflight = { existingTables: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`, [TABLES]);
const indexCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count FROM pg_indexes
  WHERE schemaname='public' AND indexname = ANY($1::text[])`, [INDEXES]);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingTables = await tableCount(context);
  if (existingTables !== 0) throw new Error("invoice link tables exist outside their migration ledger");
  return { existingTables };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('tables', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [INVOICE_PUBLIC_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`CREATE TABLE invoice_public_links (
    id serial PRIMARY KEY,
    invoice_id integer NOT NULL,
    token_hash text NOT NULL,
    created_by varchar,
    first_opened_at timestamptz,
    last_activity_at timestamptz,
    open_count integer NOT NULL DEFAULT 0,
    open_notified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query("CREATE UNIQUE INDEX invoice_public_links_token_hash_idx ON invoice_public_links (token_hash)");
  await context.client.query("CREATE INDEX invoice_public_links_invoice_idx ON invoice_public_links (invoice_id)");
  await context.client.query(`CREATE TABLE invoice_deliveries (
    id serial PRIMARY KEY,
    invoice_id integer NOT NULL,
    public_link_id integer NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    status text NOT NULL DEFAULT 'sending',
    last_error text,
    requested_by varchar,
    requested_at timestamptz NOT NULL DEFAULT now(),
    open_key_hash text,
    open_count integer NOT NULL DEFAULT 0,
    first_opened_at timestamptz,
    last_opened_at timestamptz,
    open_notified_at timestamptz
  )`);
  await context.client.query("CREATE INDEX invoice_deliveries_invoice_idx ON invoice_deliveries (invoice_id, requested_at)");
  await context.client.query("CREATE UNIQUE INDEX invoice_deliveries_open_key_idx ON invoice_deliveries (open_key_hash)");
  await context.client.query(`CREATE TABLE invoice_activities (
    id serial PRIMARY KEY,
    invoice_id integer NOT NULL,
    public_link_id integer,
    activity_type text NOT NULL,
    detail jsonb,
    actor_type text NOT NULL DEFAULT 'staff',
    actor_id varchar,
    occurred_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query("CREATE INDEX invoice_activities_invoice_time_idx ON invoice_activities (invoice_id, occurred_at)");
  return { addedTables: TABLES.length, addedIndexes: INDEXES.length, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await tableCount(context) !== TABLES.length) throw new Error("invoice link tables are missing");
  if (await indexCount(context) !== INDEXES.length) throw new Error("invoice link indexes are missing");
  return { tables: TABLES.length, indexes: INDEXES.length, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [INVOICE_PUBLIC_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  for (const table of [...TABLES].reverse()) await context.client.query(`DROP TABLE IF EXISTS ${table}`);
  return { removedTables: TABLES.length, removedIndexes: INDEXES.length, restoredRows: 0 };
}

export const invoicePublicV1Migration: MigrationDefinition<Preflight> = {
  id: INVOICE_PUBLIC_V1_ID, checksum,
  description: "The customer's invoice page and PDF, and which address opened it",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
