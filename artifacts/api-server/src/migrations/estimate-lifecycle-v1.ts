import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations";

export const ESTIMATE_LIFECYCLE_V1_ID = "estimate-lifecycle-v1";
const TABLES = [
  "estimate_appointments", "estimate_locations", "estimate_line_metadata",
  "estimate_revisions", "estimate_public_links", "estimate_delivery_requests", "estimate_activities",
] as const;
const MANIFEST = [
  ESTIMATE_LIFECYCLE_V1_ID,
  "add estimate appointments, locations, revisions, public decisions, delivery requests, activities",
  "additive only; no seed/import; no quote/job/customer or price rewrites",
].join("\n");
const checksum = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = { existingTables: number; quotes: number; jobs: number };
const numberValue = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid migration result: ${key}`);
  return value;
};
async function count(context: MigrationContext, query: string, values?: readonly unknown[]) {
  return numberValue((await context.client.query(query, values)).rows[0] ?? {}, "count");
}
async function tableCount(context: MigrationContext) {
  return count(context, `SELECT COUNT(*)::int AS count FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])`, [TABLES]);
}
async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("Estimate lifecycle migration is Sandbox-only");
  const existingTables = await tableCount(context);
  if (existingTables !== 0) throw new Error("Estimate lifecycle schema exists outside its migration ledger");
  return {
    existingTables,
    quotes: await count(context, "SELECT COUNT(*)::int AS count FROM quotes"),
    jobs: await count(context, "SELECT COUNT(*)::int AS count FROM jobs"),
  };
}
async function backup(context: MigrationContext, p: Preflight) {
  await context.client.query(`INSERT INTO application_migration_backups
    (migration_id, backup_key, previous_values)
    VALUES ($1, 'inventory', jsonb_build_object('quotes',$2::int,'jobs',$3::int,'existingTables',$4::int))
    ON CONFLICT (migration_id, backup_key) DO NOTHING`,
    [ESTIMATE_LIFECYCLE_V1_ID, p.quotes, p.jobs, p.existingTables]);
  return { backupRows: 1, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext) {
  await context.client.query(`
    CREATE TABLE estimate_appointments (
      id serial PRIMARY KEY, quote_id integer NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
      starts_at timestamptz NOT NULL, duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 1440),
      assigned_user_id varchar REFERENCES users(id) ON DELETE SET NULL, appointment_notes text, estimate_notes text,
      created_by varchar REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX estimate_appointments_schedule_idx ON estimate_appointments(starts_at, assigned_user_id);
    CREATE TABLE estimate_locations (
      id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      property_id integer NOT NULL REFERENCES properties(id) ON DELETE RESTRICT, location_notes text,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(quote_id, property_id));
    CREATE TABLE estimate_line_metadata (
      line_item_id integer PRIMARY KEY REFERENCES quote_line_items(id) ON DELETE CASCADE,
      property_id integer REFERENCES properties(id) ON DELETE RESTRICT,
      is_upsell boolean NOT NULL DEFAULT false, service_notes text);
    CREATE TABLE estimate_revisions (
      id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      revision_number integer NOT NULL CHECK (revision_number > 0), snapshot jsonb NOT NULL,
      finalized_by varchar REFERENCES users(id) ON DELETE SET NULL, finalized_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(quote_id, revision_number));
    CREATE INDEX estimate_revisions_quote_idx ON estimate_revisions(quote_id, id);
    CREATE TABLE estimate_public_links (
      id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      revision_id integer NOT NULL REFERENCES estimate_revisions(id) ON DELETE RESTRICT,
      token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, send_methods text NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now(), first_opened_at timestamptz, last_activity_at timestamptz,
      decision text CHECK (decision IS NULL OR decision IN ('accepted','declined')), decision_at timestamptz,
      decline_reason text, follow_up_requested boolean NOT NULL DEFAULT false, accepted_snapshot jsonb,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX estimate_public_links_quote_idx ON estimate_public_links(quote_id, sent_at);
    CREATE TABLE estimate_delivery_requests (
      id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      public_link_id integer NOT NULL REFERENCES estimate_public_links(id) ON DELETE CASCADE,
      channel text NOT NULL CHECK (channel IN ('email','sms')), recipient text NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','provider_unconfigured')),
      provider_message_id text, last_error text, requested_by varchar REFERENCES users(id) ON DELETE SET NULL,
      requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX estimate_delivery_requests_quote_idx ON estimate_delivery_requests(quote_id, requested_at);
    CREATE TABLE estimate_activities (
      id serial PRIMARY KEY, quote_id integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      public_link_id integer REFERENCES estimate_public_links(id) ON DELETE SET NULL, activity_type text NOT NULL,
      detail jsonb, actor_type text NOT NULL DEFAULT 'staff' CHECK (actor_type IN ('staff','customer','system')),
      actor_id varchar, occurred_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX estimate_activities_quote_time_idx ON estimate_activities(quote_id, occurred_at);
  `);
  return { createdTables: TABLES.length, seededRows: 0, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext) {
  const tables = await tableCount(context);
  if (tables !== TABLES.length) throw new Error("Estimate lifecycle schema is incomplete");
  const rows = await count(context, `SELECT
    (SELECT COUNT(*) FROM estimate_appointments) + (SELECT COUNT(*) FROM estimate_revisions) +
    (SELECT COUNT(*) FROM estimate_public_links) + (SELECT COUNT(*) FROM estimate_delivery_requests) AS count`);
  if (rows !== 0) throw new Error("Estimate lifecycle migration unexpectedly seeded rows");
  return { tables, seededRows: rows, historicalRowsRewritten: 0 };
}
async function rollback(context: MigrationContext) {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id=$1 AND backup_key='inventory'`, [ESTIMATE_LIFECYCLE_V1_ID]);
  if (backups !== 1) throw new Error("Estimate lifecycle rollback requires inventory backup");
  await context.client.query(`DROP TABLE IF EXISTS estimate_activities, estimate_delivery_requests,
    estimate_public_links, estimate_revisions, estimate_line_metadata, estimate_locations, estimate_appointments CASCADE`);
  return { removedTables: TABLES.length, restoredRows: 0 };
}
export const estimateLifecycleV1Migration: MigrationDefinition<Preflight> = {
  id: ESTIMATE_LIFECYCLE_V1_ID, checksum,
  description: "Add the durable estimate appointment and decision lifecycle",
  required: true, preflight, backup, apply, postflight: verify, verify, rollback,
};