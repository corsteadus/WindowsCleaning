import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

/**
 * The business's own identity on its estimates — phase 8, Kyle's Video 6: name,
 * address, phone, email, website, logo, an estimate footer, and what an estimate
 * shows. Additive: one new table, empty; until it is filled in, estimates read as
 * they do today.
 */
export const COMPANY_PROFILE_V1_ID = "company-profile-v1";
const MANIFEST = [
  COMPANY_PROFILE_V1_ID,
  "create table company_profile (one row per organization; logo as base64 JPEG <= 700000 chars; footer <= 1000)",
  "additive only; no row is rewritten",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingTable: number };
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  const value = Number((await context.client.query(query, values)).rows[0]?.count ?? 0);
  if (!Number.isFinite(value)) throw new Error("Invalid migration result: count");
  return value;
}
const tableCount = (context: MigrationContext) => count(context, `SELECT COUNT(*)::int AS count
  FROM information_schema.tables WHERE table_schema='public' AND table_name='company_profile'`);

async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("This migration is Sandbox-only");
  const existingTable = await tableCount(context);
  if (existingTable !== 0) throw new Error("company_profile exists outside its migration ledger");
  return { existingTable };
}
async function backup(context: MigrationContext) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('company_profile', 0))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`, [COMPANY_PROFILE_V1_ID]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`CREATE TABLE company_profile (
    id serial PRIMARY KEY,
    organization_key text NOT NULL DEFAULT 'default',
    business_name text,
    address text,
    city text,
    state text,
    zip text,
    phone text,
    email text,
    website text,
    logo_jpeg text,
    logo_width integer,
    logo_height integer,
    estimate_footer text,
    show_unit_prices boolean NOT NULL DEFAULT true,
    show_service_descriptions boolean NOT NULL DEFAULT true,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT company_profile_logo_size_check CHECK (logo_jpeg IS NULL OR length(logo_jpeg) <= 700000),
    CONSTRAINT company_profile_footer_length_check CHECK (estimate_footer IS NULL OR length(estimate_footer) <= 1000)
  )`);
  await context.client.query("CREATE UNIQUE INDEX company_profile_org_idx ON company_profile (organization_key)");
  return { addedTables: 1, addedIndexes: 1, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  if (await tableCount(context) !== 1) throw new Error("company_profile is missing");
  return { tables: 1, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [COMPANY_PROFILE_V1_ID]);
  if (backups !== 1) throw new Error("Rollback requires the inventory backup");
  await context.client.query("DROP TABLE IF EXISTS company_profile");
  return { removedTables: 1, restoredRows: 0 };
}

export const companyProfileV1Migration: MigrationDefinition<Preflight> = {
  id: COMPANY_PROFILE_V1_ID, checksum,
  description: "The business's identity and branding on estimates",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};
