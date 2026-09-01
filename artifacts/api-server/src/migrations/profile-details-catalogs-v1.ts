import { createHash } from "node:crypto";
import type { MigrationContext, MigrationDefinition } from "./application-migrations.ts";

export const PROFILE_DETAILS_CATALOGS_V1_ID = "profile-details-catalogs-v1";

const MANIFEST = [
  PROFILE_DETAILS_CATALOGS_V1_ID,
  "add account profile settings, catalogs, contact channels, and custom fields",
  "add nullable property county, subdivision, directions, and location notes",
  "do not seed, import, or rewrite customer, estimate, job, or price data",
].join("\n");
export const PROFILE_DETAILS_CATALOGS_V1_CHECKSUM = createHash("sha256").update(MANIFEST).digest("hex");

type Preflight = {
  customers: number;
  properties: number;
  existingProfileTables: number;
  existingPropertyColumns: number;
};
function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric migration result: ${key}`);
  return value;
}
async function count(context: MigrationContext, query: string): Promise<number> {
  return numberValue((await context.client.query(query)).rows[0] ?? {}, "count");
}
const TABLES = [
  "profile_catalog_items", "account_profile_settings", "contact_channels",
  "contact_channel_purposes", "custom_field_definitions", "custom_field_values",
] as const;

async function tableCount(context: MigrationContext): Promise<number> {
  const result = await context.client.query(
    `SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [TABLES],
  );
  return numberValue(result.rows[0] ?? {}, "count");
}
async function preflight(context: MigrationContext): Promise<Preflight> {
  if (context.environment !== "sandbox") throw new Error("Profile details catalog migration is Sandbox-only");
  const customers = await count(context, "SELECT COUNT(*)::int AS count FROM customers");
  const properties = await count(context, "SELECT COUNT(*)::int AS count FROM properties");
  const existingProfileTables = await tableCount(context);
  const existingPropertyColumns = await count(context, `SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'properties'
        AND column_name = ANY(ARRAY['county','subdivision','directions','location_notes'])`);
  if (existingProfileTables !== 0 || existingPropertyColumns !== 0) {
    throw new Error("Profile details schema already exists outside the migration ledger; manual review required");
  }
  return { customers, properties, existingProfileTables, existingPropertyColumns };
}
async function backup(context: MigrationContext, preflightResult: Preflight): Promise<Record<string, unknown>> {
  // Adding nullable columns/tables is non-destructive. A small, idempotent
  // inventory backup gives rollback an auditable proof that no source rows
  // were rewritten without copying customer PII into migration backups.
  await context.client.query(
    `INSERT INTO application_migration_backups (migration_id, backup_key, previous_values)
     VALUES ($1, 'inventory', jsonb_build_object(
       'customers', $2::int, 'properties', $3::int,
       'existingProfileTables', $4::int, 'existingPropertyColumns', $5::int))
     ON CONFLICT (migration_id, backup_key) DO NOTHING`,
    [
      PROFILE_DETAILS_CATALOGS_V1_ID,
      preflightResult.customers,
      preflightResult.properties,
      preflightResult.existingProfileTables,
      preflightResult.existingPropertyColumns,
    ],
  );
  const rows = await count(context,
    `SELECT COUNT(*)::int AS count FROM application_migration_backups
      WHERE migration_id = '${PROFILE_DETAILS_CATALOGS_V1_ID}' AND backup_key = 'inventory'`);
  if (rows !== 1) throw new Error("Profile details backup inventory verification failed");
  return { backupRows: rows, historicalRowsRewritten: 0 };
}
async function apply(context: MigrationContext): Promise<Record<string, unknown>> {
  await context.client.query(`ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS county text,
    ADD COLUMN IF NOT EXISTS subdivision text,
    ADD COLUMN IF NOT EXISTS directions text,
    ADD COLUMN IF NOT EXISTS location_notes text`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS profile_catalog_items (
    id serial PRIMARY KEY, catalog_type text NOT NULL, code text NOT NULL, name text NOT NULL,
    description text, pricing_type text, default_price numeric(10,2), unit text,
    estimated_duration integer, days_until_due integer, is_default boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profile_catalog_items_type_code_key UNIQUE (catalog_type, code),
    CONSTRAINT profile_catalog_items_type_allowed CHECK (catalog_type IN
      ('profile_type','profile_group','county','payment_terms','marketing_source','service_type','job_type')),
    CONSTRAINT profile_catalog_items_price_nonnegative CHECK (default_price IS NULL OR default_price >= 0),
    CONSTRAINT profile_catalog_items_days_nonnegative CHECK (days_until_due IS NULL OR days_until_due >= 0)
  )`);
  await context.client.query(`CREATE INDEX IF NOT EXISTS profile_catalog_items_type_active_order_idx
    ON profile_catalog_items (catalog_type, is_active, sort_order)`);
  await context.client.query(`CREATE UNIQUE INDEX IF NOT EXISTS profile_catalog_items_one_default_idx
    ON profile_catalog_items (catalog_type) WHERE is_default = true AND is_active = true`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS account_profile_settings (
    customer_id integer PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    profile_type_id integer REFERENCES profile_catalog_items(id) ON DELETE SET NULL,
    profile_group_id integer REFERENCES profile_catalog_items(id) ON DELETE SET NULL,
    payment_terms_id integer REFERENCES profile_catalog_items(id) ON DELETE SET NULL,
    marketing_source_id integer REFERENCES profile_catalog_items(id) ON DELETE SET NULL,
    payment_terms_override text, preferred_contact_method text,
    sending_preferences text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS contact_channels (
    id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    contact_id integer REFERENCES contacts(id) ON DELETE SET NULL,
    channel_type text NOT NULL CHECK (channel_type IN ('email', 'phone')),
    label text NOT NULL, value text NOT NULL, is_primary boolean NOT NULL DEFAULT false, notes text,
    archived_at timestamptz, archived_by text, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await context.client.query(`CREATE INDEX IF NOT EXISTS contact_channels_customer_active_idx ON contact_channels (customer_id, archived_at);
    CREATE INDEX IF NOT EXISTS contact_channels_contact_active_idx ON contact_channels (contact_id, archived_at)`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS contact_channel_purposes (
    channel_id integer NOT NULL REFERENCES contact_channels(id) ON DELETE CASCADE, purpose text NOT NULL,
    PRIMARY KEY (channel_id, purpose), CONSTRAINT contact_channel_purposes_allowed CHECK (purpose IN ('general', 'billing', 'estimates'))
  )`);
  await context.client.query(`CREATE INDEX IF NOT EXISTS contact_channel_purposes_purpose_idx ON contact_channel_purposes (purpose)`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id serial PRIMARY KEY, field_key text NOT NULL UNIQUE, label text NOT NULL, field_type text NOT NULL DEFAULT 'text',
    scope text NOT NULL DEFAULT 'account' CHECK (scope = 'account'),
    template text NOT NULL DEFAULT 'all' CHECK (template IN ('all', 'residential', 'commercial')),
    is_required boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  ); CREATE INDEX IF NOT EXISTS custom_field_definitions_active_order_idx ON custom_field_definitions (is_active, sort_order)`);
  await context.client.query(`CREATE TABLE IF NOT EXISTS custom_field_values (
    customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    definition_id integer NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE, value text,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (customer_id, definition_id)
  ); CREATE INDEX IF NOT EXISTS custom_field_values_definition_idx ON custom_field_values (definition_id)`);
  return { createdOrVerifiedTables: TABLES.length, seededRows: 0, historicalRowsRewritten: 0 };
}
async function verify(context: MigrationContext): Promise<Record<string, unknown>> {
  const tables = await tableCount(context);
  const columns = await count(context, `SELECT COUNT(*)::int AS count FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'properties'
      AND column_name = ANY(ARRAY['county','subdivision','directions','location_notes'])`);
  if (tables !== TABLES.length || columns !== 4) throw new Error("Profile details catalog schema is incomplete");
  return { tables, propertyColumns: columns, seededRows: 0 };
}
async function rollback(context: MigrationContext): Promise<Record<string, unknown>> {
  const backups = await count(context, `SELECT COUNT(*)::int AS count FROM application_migration_backups
    WHERE migration_id = '${PROFILE_DETAILS_CATALOGS_V1_ID}' AND backup_key = 'inventory'`);
  if (backups !== 1) throw new Error("Profile details rollback requires its inventory backup");
  await context.client.query(`DROP TABLE IF EXISTS custom_field_values, custom_field_definitions,
    contact_channel_purposes, contact_channels, account_profile_settings, profile_catalog_items CASCADE`);
  await context.client.query(`ALTER TABLE properties DROP COLUMN IF EXISTS location_notes,
    DROP COLUMN IF EXISTS directions, DROP COLUMN IF EXISTS subdivision, DROP COLUMN IF EXISTS county`);
  return { removedTables: TABLES.length, removedPropertyColumns: 4, restoredRows: 0 };
}
export const profileDetailsCatalogsV1Migration: MigrationDefinition<Preflight> = {
  id: PROFILE_DETAILS_CATALOGS_V1_ID, checksum: PROFILE_DETAILS_CATALOGS_V1_CHECKSUM,
  description: "Add profile details, catalogs, channels, and account custom fields",
  required: true, preflight, backup, apply,
  postflight: async (context) => verify(context), verify, rollback,
};