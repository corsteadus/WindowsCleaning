import { createHash } from "node:crypto";
import type {
  MigrationContext,
  MigrationDefinition,
} from "./application-migrations.ts";

export const PROPERTIES_CONTACTS_V1_ID = "properties-contacts-v1";

const MIGRATION_MANIFEST = [
  PROPERTIES_CONTACTS_V1_ID,
  "backup customers, contacts, properties, and property_account_relationships before backfill",
  "backfill one primary contact from legacy customer contact fields when usable",
  "backfill one primary billing/service property from usable legacy billing fields",
  "create owner relationships for every property without address-based merging",
  "set customers.default_property_id only when it is currently null",
  "verify active primary and relationship uniqueness plus backup coverage",
].join("\n");

export const PROPERTIES_CONTACTS_V1_CHECKSUM = createHash("sha256")
  .update(MIGRATION_MANIFEST)
  .digest("hex");

interface PropertiesContactsPreflight {
  customers: number;
  usableLegacyContacts: number;
  usableLegacyProperties: number;
  existingContacts: number;
  existingProperties: number;
  existingRelationships: number;
  duplicatePrimaryContacts: number;
  duplicatePrimaryProperties: number;
  duplicateRelationships: number;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric migration result: ${key}`);
  return value;
}

async function count(
  context: MigrationContext,
  query: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await context.client.query(query, values);
  return numberValue(result.rows[0] ?? {}, "count");
}

async function assertColumns(context: MigrationContext): Promise<void> {
  const expected = [
    ["contacts", "alternate_phone"],
    ["contacts", "archived_at"],
    ["contacts", "migration_source"],
    ["properties", "billing_address"],
    ["properties", "archived_at"],
    ["properties", "migration_source"],
    ["property_account_relationships", "archived_at"],
    ["property_account_relationships", "migration_source"],
  ] as const;
  const result = await context.client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ${expected.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ")}
        )`,
    expected.flat(),
  );
  const present = new Set(result.rows.map((row) => `${row.table_name}:${row.column_name}`));
  const missing = expected
    .map(([table, column]) => `${table}:${column}`)
    .filter((key) => !present.has(key));
  if (missing.length > 0) throw new Error(`Properties and contacts schema is incomplete: ${missing.join(", ")}`);
}

async function readVerification(context: MigrationContext): Promise<Record<string, unknown>> {
  const [counts, quality, backup] = await Promise.all([
    context.client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM customers) AS customers,
         (SELECT COUNT(*)::int FROM contacts) AS contacts,
         (SELECT COUNT(*)::int FROM properties) AS properties,
         (SELECT COUNT(*)::int FROM property_account_relationships) AS relationships`,
    ),
    context.client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM (
            SELECT customer_id FROM contacts
             WHERE archived_at IS NULL AND is_primary = true
             GROUP BY customer_id HAVING COUNT(*) > 1
          ) x) AS duplicate_primary_contacts,
         (SELECT COUNT(*)::int FROM (
            SELECT customer_id FROM properties
             WHERE archived_at IS NULL AND is_primary = true
             GROUP BY customer_id HAVING COUNT(*) > 1
          ) x) AS duplicate_primary_properties,
         (SELECT COUNT(*)::int FROM (
            SELECT property_id, customer_id FROM property_account_relationships
             WHERE archived_at IS NULL
             GROUP BY property_id, customer_id HAVING COUNT(*) > 1
          ) x) AS duplicate_relationships,
         (SELECT COUNT(*)::int FROM customers c
           WHERE (
             NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.customer_id = c.id AND x.archived_at IS NULL)
           ) OR (
             EXISTS (SELECT 1 FROM contacts x WHERE x.customer_id = c.id AND x.archived_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.customer_id = c.id AND x.archived_at IS NULL AND x.is_primary = true)
           )) AS customers_missing_primary_contact,
         (SELECT COUNT(*)::int FROM customers c
           WHERE (
             NULLIF(BTRIM(c.billing_address), '') IS NOT NULL
             AND NULLIF(BTRIM(c.billing_city), '') IS NOT NULL
             AND NULLIF(BTRIM(c.billing_state), '') IS NOT NULL
             AND NULLIF(BTRIM(c.billing_zip), '') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.customer_id = c.id AND x.archived_at IS NULL)
           ) OR (
             EXISTS (SELECT 1 FROM properties x WHERE x.customer_id = c.id AND x.archived_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM properties x WHERE x.customer_id = c.id AND x.archived_at IS NULL AND x.is_primary = true)
           )) AS customers_missing_primary_property`,
    ),
    context.client.query(
      `SELECT COUNT(*)::int AS backup_rows,
              COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
         FROM application_migration_backups
        WHERE migration_id = $1`,
      [PROPERTIES_CONTACTS_V1_ID],
    ),
  ]);

  const countRow = counts.rows[0] ?? {};
  const qualityRow = quality.rows[0] ?? {};
  const backupRow = backup.rows[0] ?? {};
  return {
    customers: numberValue(countRow, "customers"),
    contacts: numberValue(countRow, "contacts"),
    properties: numberValue(countRow, "properties"),
    relationships: numberValue(countRow, "relationships"),
    duplicatePrimaryContacts: numberValue(qualityRow, "duplicate_primary_contacts"),
    duplicatePrimaryProperties: numberValue(qualityRow, "duplicate_primary_properties"),
    duplicateRelationships: numberValue(qualityRow, "duplicate_relationships"),
    customersMissingPrimaryContact: numberValue(qualityRow, "customers_missing_primary_contact"),
    customersMissingPrimaryProperty: numberValue(qualityRow, "customers_missing_primary_property"),
    backupRows: numberValue(backupRow, "backup_rows"),
    distinctBackupKeys: numberValue(backupRow, "distinct_backup_keys"),
  };
}

async function preflight(context: MigrationContext): Promise<PropertiesContactsPreflight> {
  await assertColumns(context);

  const [customers, usableLegacyContacts, usableLegacyProperties, existingContacts, existingProperties,
    existingRelationships, duplicatePrimaryContacts, duplicatePrimaryProperties, duplicateRelationships] =
    await Promise.all([
      count(context, "SELECT COUNT(*)::int AS count FROM customers"),
      count(context, `SELECT COUNT(*)::int AS count FROM customers
        WHERE NULLIF(BTRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') IS NOT NULL`),
      count(context, `SELECT COUNT(*)::int AS count FROM customers
        WHERE NULLIF(BTRIM(billing_address), '') IS NOT NULL
          AND NULLIF(BTRIM(billing_city), '') IS NOT NULL
          AND NULLIF(BTRIM(billing_state), '') IS NOT NULL
          AND NULLIF(BTRIM(billing_zip), '') IS NOT NULL`),
      count(context, "SELECT COUNT(*)::int AS count FROM contacts"),
      count(context, "SELECT COUNT(*)::int AS count FROM properties"),
      count(context, "SELECT COUNT(*)::int AS count FROM property_account_relationships"),
      count(context, `SELECT COUNT(*)::int AS count FROM (
        SELECT customer_id FROM contacts
         WHERE archived_at IS NULL AND is_primary = true
         GROUP BY customer_id HAVING COUNT(*) > 1
      ) x`),
      count(context, `SELECT COUNT(*)::int AS count FROM (
        SELECT customer_id FROM properties
         WHERE archived_at IS NULL AND is_primary = true
         GROUP BY customer_id HAVING COUNT(*) > 1
      ) x`),
      count(context, `SELECT COUNT(*)::int AS count FROM (
        SELECT property_id, customer_id FROM property_account_relationships
         WHERE archived_at IS NULL
         GROUP BY property_id, customer_id HAVING COUNT(*) > 1
      ) x`),
    ]);

  if (duplicatePrimaryContacts || duplicatePrimaryProperties || duplicateRelationships) {
    throw new Error("Existing active primary or relationship duplicates must be resolved before migration");
  }

  const dangling = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM property_account_relationships r
       LEFT JOIN properties p ON p.id = r.property_id
       LEFT JOIN customers c ON c.id = r.customer_id
      WHERE p.id IS NULL OR c.id IS NULL`,
  );
  if (numberValue(dangling.rows[0] ?? {}, "count") > 0) {
    throw new Error("Existing property relationships contain dangling references");
  }

  return {
    customers,
    usableLegacyContacts,
    usableLegacyProperties,
    existingContacts,
    existingProperties,
    existingRelationships,
    duplicatePrimaryContacts,
    duplicatePrimaryProperties,
    duplicateRelationships,
  };
}

async function backup(
  context: MigrationContext,
  _preflight: PropertiesContactsPreflight,
): Promise<Record<string, unknown>> {
  await context.client.query(
    `INSERT INTO application_migration_backups
      (migration_id, backup_key, previous_values)
     SELECT $1, 'customer:' || c.id::text,
            jsonb_build_object(
              'table', 'customers', 'id', c.id,
              'defaultPropertyId', c.default_property_id,
              'billingAddress', c.billing_address, 'billingCity', c.billing_city,
              'billingState', c.billing_state, 'billingZip', c.billing_zip
            )
       FROM customers c
     UNION ALL
     SELECT $1, 'contact:' || c.id::text,
            jsonb_build_object('table', 'contacts', 'id', c.id, 'customerId', c.customer_id)
       FROM contacts c
     UNION ALL
     SELECT $1, 'property:' || p.id::text,
            jsonb_build_object('table', 'properties', 'id', p.id, 'customerId', p.customer_id)
       FROM properties p
     UNION ALL
     SELECT $1, 'relationship:' || r.id::text,
            jsonb_build_object('table', 'property_account_relationships', 'id', r.id,
                               'propertyId', r.property_id, 'customerId', r.customer_id)
       FROM property_account_relationships r
     ON CONFLICT (migration_id, backup_key) DO NOTHING`,
    [PROPERTIES_CONTACTS_V1_ID],
  );

  const result = await context.client.query(
    `SELECT COUNT(*)::int AS backup_rows,
            COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
       FROM application_migration_backups
      WHERE migration_id = $1`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  const row = result.rows[0] ?? {};
  const backupRows = numberValue(row, "backup_rows");
  const distinctBackupKeys = numberValue(row, "distinct_backup_keys");
  const expected = _preflight.customers + _preflight.existingContacts +
    _preflight.existingProperties + _preflight.existingRelationships;
  if (backupRows !== expected || distinctBackupKeys !== expected) {
    throw new Error("Properties and contacts backup verification failed");
  }
  return { backupRows, distinctBackupKeys, expected };
}

async function apply(
  context: MigrationContext,
  _preflight: PropertiesContactsPreflight,
): Promise<Record<string, unknown>> {
  const contacts = await context.client.query(
    `INSERT INTO contacts
      (customer_id, first_name, last_name, email, phone, alternate_phone, role,
       is_primary, receive_sms, receive_email, notes, migration_source)
     SELECT c.id, BTRIM(c.first_name), BTRIM(c.last_name), NULLIF(BTRIM(c.email), ''),
            COALESCE(NULLIF(BTRIM(c.cell_phone), ''), NULLIF(BTRIM(c.phone), ''),
                     NULLIF(BTRIM(c.home_phone), ''), NULLIF(BTRIM(c.work_phone), '')),
            COALESCE(NULLIF(BTRIM(c.alternate_phone), ''), NULLIF(BTRIM(c.alt_phone), '')),
            NULLIF(BTRIM(c.alt_contact), ''),
            true,
            COALESCE(c.sending_preferences ILIKE '%sms%', false),
            COALESCE(c.sending_preferences ILIKE '%email%', false),
            c.notes,
            $1
       FROM customers c
      WHERE NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM contacts x
           WHERE x.customer_id = c.id AND x.archived_at IS NULL
        )
     RETURNING id`,
    [PROPERTIES_CONTACTS_V1_ID],
  );

  const promotedContacts = await context.client.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY id) AS position
         FROM contacts
        WHERE archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM contacts p
             WHERE p.customer_id = contacts.customer_id
               AND p.archived_at IS NULL AND p.is_primary = true
          )
     )
     UPDATE contacts c
        SET is_primary = true
       FROM ranked r
      WHERE c.id = r.id AND r.position = 1`,
  );

  const properties = await context.client.query(
    `INSERT INTO properties
      (customer_id, name, address, city, state, zip,
       billing_address, billing_city, billing_state, billing_zip,
       property_type, is_primary, is_manual_default, is_billing_address, migration_source)
     SELECT c.id, COALESCE(NULLIF(BTRIM(c.company_name), ''), 'Primary service property'),
            BTRIM(c.billing_address), BTRIM(c.billing_city), BTRIM(c.billing_state), BTRIM(c.billing_zip),
            BTRIM(c.billing_address), BTRIM(c.billing_city), BTRIM(c.billing_state), BTRIM(c.billing_zip),
            COALESCE(c.client_type, 'residential'), true, false, true, $1
       FROM customers c
      WHERE NULLIF(BTRIM(c.billing_address), '') IS NOT NULL
        AND NULLIF(BTRIM(c.billing_city), '') IS NOT NULL
        AND NULLIF(BTRIM(c.billing_state), '') IS NOT NULL
        AND NULLIF(BTRIM(c.billing_zip), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM properties x
           WHERE x.customer_id = c.id AND x.archived_at IS NULL
        )
     RETURNING id`,
    [PROPERTIES_CONTACTS_V1_ID],
  );

  const promotedProperties = await context.client.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY id) AS position
         FROM properties
        WHERE archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM properties p
             WHERE p.customer_id = properties.customer_id
               AND p.archived_at IS NULL AND p.is_primary = true
          )
     )
     UPDATE properties p
        SET is_primary = true
       FROM ranked r
      WHERE p.id = r.id AND r.position = 1`,
  );

  const relationships = await context.client.query(
    `INSERT INTO property_account_relationships
      (property_id, customer_id, relationship_type, is_primary, migration_source)
     SELECT p.id, p.customer_id, 'owner', p.is_primary, $1
       FROM properties p
      WHERE NOT EXISTS (
        SELECT 1 FROM property_account_relationships r
         WHERE r.property_id = p.id AND r.customer_id = p.customer_id
           AND r.archived_at IS NULL
      )
     RETURNING id`,
    [PROPERTIES_CONTACTS_V1_ID],
  );

  const defaults = await context.client.query(
    `UPDATE customers c
        SET default_property_id = p.id
       FROM properties p
      WHERE p.customer_id = c.id
        AND p.archived_at IS NULL
        AND p.is_primary = true
        AND c.default_property_id IS NULL`,
  );

  return {
    contactsCreated: contacts.rowCount ?? 0,
    contactsPromoted: promotedContacts.rowCount ?? 0,
    propertiesCreated: properties.rowCount ?? 0,
    propertiesPromoted: promotedProperties.rowCount ?? 0,
    relationshipsCreated: relationships.rowCount ?? 0,
    defaultsSet: defaults.rowCount ?? 0,
  };
}

async function postflight(
  context: MigrationContext,
  _preflight: PropertiesContactsPreflight,
): Promise<Record<string, unknown>> {
  const result = await readVerification(context);
  if (
    Number(result.duplicatePrimaryContacts) !== 0 ||
    Number(result.duplicatePrimaryProperties) !== 0 ||
    Number(result.duplicateRelationships) !== 0 ||
    Number(result.customersMissingPrimaryContact) !== 0 ||
    Number(result.customersMissingPrimaryProperty) !== 0 ||
    Number(result.backupRows) !== Number(result.distinctBackupKeys)
  ) {
    throw new Error("Properties and contacts postflight verification failed");
  }
  return result;
}

async function rollback(context: MigrationContext): Promise<Record<string, unknown>> {
  const backup = await context.client.query(
    `SELECT COUNT(*)::int AS backup_rows,
            COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
       FROM application_migration_backups
      WHERE migration_id = $1`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  const backupRow = backup.rows[0] ?? {};
  const backupRows = numberValue(backupRow, "backup_rows");
  const distinctBackupKeys = numberValue(backupRow, "distinct_backup_keys");
  if (backupRows === 0 || backupRows !== distinctBackupKeys) {
    throw new Error("Properties and contacts rollback backup verification failed");
  }

  const relationships = await context.client.query(
    `DELETE FROM property_account_relationships
      WHERE migration_source = $1`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  const properties = await context.client.query(
    `DELETE FROM properties
      WHERE migration_source = $1`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  const contacts = await context.client.query(
    `DELETE FROM contacts
      WHERE migration_source = $1`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  const customers = await context.client.query(
    `UPDATE customers c
        SET default_property_id = NULLIF(b.previous_values->>'defaultPropertyId', '')::int
       FROM application_migration_backups b
      WHERE b.migration_id = $1
        AND b.backup_key = 'customer:' || c.id::text`,
    [PROPERTIES_CONTACTS_V1_ID],
  );
  return {
    backupRows,
    restoredCustomerDefaults: customers.rowCount ?? 0,
    removedRelationships: relationships.rowCount ?? 0,
    removedProperties: properties.rowCount ?? 0,
    removedContacts: contacts.rowCount ?? 0,
  };
}

export const propertiesContactsV1Migration: MigrationDefinition<PropertiesContactsPreflight> = {
  id: PROPERTIES_CONTACTS_V1_ID,
  checksum: PROPERTIES_CONTACTS_V1_CHECKSUM,
  description: "Backfill canonical contacts, properties, and owner relationships",
  required: true,
  preflight,
  backup,
  apply,
  postflight,
  verify: readVerification,
  rollback,
};