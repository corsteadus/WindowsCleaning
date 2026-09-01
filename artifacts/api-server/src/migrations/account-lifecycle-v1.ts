import { createHash } from "node:crypto";
import type {
  MigrationContext,
  MigrationDefinition,
} from "./application-migrations.ts";

const SUPPORTED_LIFECYCLE_STATUSES = [
  "prospect",
  "customer",
  "inactive",
  "archived",
] as const;

const SUPPORTED_ACCOUNT_TYPES = ["residential", "commercial"] as const;

const MIGRATION_MANIFEST = [
  "account-lifecycle-v1",
  "backup customers.id,lifecycle_status,status",
  "derive active=>customer; prospect=>prospect; inactive=>inactive; archived=>archived",
  "update lifecycle_status only when distinct from derived legacy status",
  "postflight zero mismatches and zero dangling logical references",
].join("\n");

export const ACCOUNT_LIFECYCLE_V1_ID = "account-lifecycle-v1";
export const ACCOUNT_LIFECYCLE_V1_CHECKSUM = createHash("sha256")
  .update(MIGRATION_MANIFEST)
  .digest("hex");

interface AccountLifecyclePreflight {
  totalCustomers: number;
  mismatchCount: number;
  unsupportedStatusCount: number;
  unsupportedAccountTypeCount: number;
  danglingReferences: Record<string, number>;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric migration result: ${key}`);
  return value;
}

function lifecycleForStatus(status: string): string {
  return status === "active" ? "customer" : status;
}

async function queryCount(
  context: MigrationContext,
  query: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await context.client.query(query, values);
  return numberValue(result.rows[0] ?? {}, "count");
}

async function readVerification(
  context: MigrationContext,
): Promise<Record<string, unknown>> {
  const counts = await context.client.query(
    `SELECT lifecycle_status AS lifecycle, COUNT(*)::int AS count
       FROM customers
      GROUP BY lifecycle_status
      ORDER BY lifecycle_status`,
  );
  const quality = await context.client.query(
    `SELECT
       COUNT(*) FILTER (WHERE lifecycle_status IS NULL)::int AS null_lifecycle,
       COUNT(*) FILTER (
         WHERE lifecycle_status NOT IN ('prospect', 'customer', 'inactive', 'archived')
       )::int AS unsupported_lifecycle,
       COUNT(*) FILTER (WHERE status IS NULL)::int AS null_status,
       COUNT(*) FILTER (
         WHERE status NOT IN ('active', 'prospect', 'inactive', 'archived')
       )::int AS unsupported_status,
       COUNT(*) FILTER (WHERE client_type IS NULL)::int AS null_account_type,
       COUNT(*) FILTER (
         WHERE client_type NOT IN ('residential', 'commercial')
       )::int AS unsupported_account_type
     FROM customers`,
  );
  const mismatches = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM customers
      WHERE lifecycle_status IS DISTINCT FROM
        CASE WHEN status = 'active' THEN 'customer' ELSE status END`,
  );
  const backup = await context.client.query(
    `SELECT COUNT(*)::int AS backup_rows,
            COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
       FROM application_migration_backups
      WHERE migration_id = $1`,
    [ACCOUNT_LIFECYCLE_V1_ID],
  );

  const qualityRow = quality.rows[0] ?? {};
  const backupRow = backup.rows[0] ?? {};
  return {
    totalCustomers: await queryCount(
      context,
      "SELECT COUNT(*)::int AS count FROM customers",
    ),
    lifecycleCounts: counts.rows,
    mismatches: numberValue(mismatches.rows[0] ?? {}, "count"),
    nullLifecycle: numberValue(qualityRow, "null_lifecycle"),
    unsupportedLifecycle: numberValue(qualityRow, "unsupported_lifecycle"),
    nullStatus: numberValue(qualityRow, "null_status"),
    unsupportedStatus: numberValue(qualityRow, "unsupported_status"),
    nullAccountType: numberValue(qualityRow, "null_account_type"),
    unsupportedAccountType: numberValue(qualityRow, "unsupported_account_type"),
    backupRows: numberValue(backupRow, "backup_rows"),
    distinctBackupKeys: numberValue(backupRow, "distinct_backup_keys"),
  };
}

async function preflight(
  context: MigrationContext,
): Promise<AccountLifecyclePreflight> {
  const column = await context.client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name = 'lifecycle_status'`,
  );
  if (column.rows.length !== 1) {
    throw new Error("customers.lifecycle_status is not present");
  }

  const unsupportedStatusCount = await queryCount(
    context,
    `SELECT COUNT(*)::int AS count
       FROM customers
      WHERE status IS NULL
         OR status NOT IN ('active', 'prospect', 'inactive', 'archived')`,
  );
  if (unsupportedStatusCount > 0) {
    throw new Error("Unsupported or null legacy customer status");
  }

  const unsupportedAccountTypeCount = await queryCount(
    context,
    `SELECT COUNT(*)::int AS count
       FROM customers
      WHERE client_type IS NULL
         OR client_type NOT IN ('residential', 'commercial')`,
  );
  if (unsupportedAccountTypeCount > 0) {
    throw new Error("Unsupported or null customer account type");
  }

  const danglingResult = await context.client.query(
    `SELECT 'contacts.customer_id' AS reference, COUNT(*)::int AS dangling_count
       FROM contacts c LEFT JOIN customers x ON x.id = c.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'properties.customer_id', COUNT(*)::int
       FROM properties p LEFT JOIN customers x ON x.id = p.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'property_account_relationships.customer_id', COUNT(*)::int
       FROM property_account_relationships r LEFT JOIN customers x ON x.id = r.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'jobs.customer_id', COUNT(*)::int
       FROM jobs j LEFT JOIN customers x ON x.id = j.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'recurring_plans.customer_id', COUNT(*)::int
       FROM recurring_plans p LEFT JOIN customers x ON x.id = p.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'invoices.customer_id', COUNT(*)::int
       FROM invoices i LEFT JOIN customers x ON x.id = i.customer_id
      WHERE x.id IS NULL
     UNION ALL
     SELECT 'quotes.customer_id', COUNT(*)::int
       FROM quotes q LEFT JOIN customers x ON x.id = q.customer_id
      WHERE q.customer_id IS NOT NULL AND x.id IS NULL
     UNION ALL
     SELECT 'leads.converted_customer_id', COUNT(*)::int
       FROM leads l LEFT JOIN customers x ON x.id = l.converted_customer_id
      WHERE l.converted_customer_id IS NOT NULL AND x.id IS NULL`,
  );
  const danglingReferences = Object.fromEntries(
    danglingResult.rows.map((row) => [
      String(row.reference),
      numberValue(row, "dangling_count"),
    ]),
  );
  if (Object.values(danglingReferences).some((count) => count !== 0)) {
    throw new Error("Dangling logical customer references detected");
  }

  const verification = await readVerification(context);
  return {
    totalCustomers: Number(verification.totalCustomers),
    mismatchCount: Number(verification.mismatches),
    unsupportedStatusCount,
    unsupportedAccountTypeCount,
    danglingReferences,
  };
}

async function backup(
  context: MigrationContext,
  preflightResult: AccountLifecyclePreflight,
): Promise<Record<string, unknown>> {
  await context.client.query(
    `INSERT INTO application_migration_backups
      (migration_id, backup_key, previous_values)
     SELECT $1,
            c.id::text,
            jsonb_build_object(
              'customerId', c.id,
              'lifecycleStatus', c.lifecycle_status,
              'status', c.status
            )
       FROM customers c
     ON CONFLICT (migration_id, backup_key) DO NOTHING`,
    [ACCOUNT_LIFECYCLE_V1_ID],
  );

  const result = await context.client.query(
    `SELECT COUNT(*)::int AS backup_rows,
            COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
       FROM application_migration_backups
      WHERE migration_id = $1`,
    [ACCOUNT_LIFECYCLE_V1_ID],
  );
  const row = result.rows[0] ?? {};
  const backupRows = numberValue(row, "backup_rows");
  const distinctBackupKeys = numberValue(row, "distinct_backup_keys");
  assertBackupCoverage(
    preflightResult.totalCustomers,
    backupRows,
    distinctBackupKeys,
  );
  return {
    backupRows,
    distinctBackupKeys,
  };
}

export function assertBackupCoverage(
  expectedRows: number,
  backupRows: number,
  distinctBackupKeys: number,
): void {
  if (backupRows !== expectedRows || distinctBackupKeys !== expectedRows) {
    throw new Error("Migration backup verification failed");
  }
}

async function apply(
  context: MigrationContext,
  _preflightResult: AccountLifecyclePreflight,
): Promise<Record<string, unknown>> {
  const result = await context.client.query(
    `UPDATE customers
        SET lifecycle_status =
          CASE WHEN status = 'active' THEN 'customer' ELSE status END
      WHERE lifecycle_status IS DISTINCT FROM
        CASE WHEN status = 'active' THEN 'customer' ELSE status END`,
  );
  return { updatedRows: result.rowCount ?? 0 };
}

async function postflight(
  context: MigrationContext,
  _preflightResult: AccountLifecyclePreflight,
): Promise<Record<string, unknown>> {
  const result = await readVerification(context);
  if (
    Number(result.mismatches) !== 0 ||
    Number(result.nullLifecycle) !== 0 ||
    Number(result.unsupportedLifecycle) !== 0 ||
    Number(result.nullStatus) !== 0 ||
    Number(result.unsupportedStatus) !== 0 ||
    Number(result.nullAccountType) !== 0 ||
    Number(result.unsupportedAccountType) !== 0 ||
    Number(result.backupRows) !== Number(result.totalCustomers) ||
    Number(result.distinctBackupKeys) !== Number(result.totalCustomers)
  ) {
    throw new Error("Account lifecycle postflight verification failed");
  }
  return result;
}

async function rollback(context: MigrationContext): Promise<Record<string, unknown>> {
  const backup = await context.client.query(
    `SELECT COUNT(*)::int AS backup_rows,
            COUNT(DISTINCT backup_key)::int AS distinct_backup_keys
       FROM application_migration_backups
      WHERE migration_id = $1`,
    [ACCOUNT_LIFECYCLE_V1_ID],
  );
  const backupRow = backup.rows[0] ?? {};
  const backupRows = numberValue(backupRow, "backup_rows");
  const distinctBackupKeys = numberValue(backupRow, "distinct_backup_keys");
  if (backupRows === 0 || backupRows !== distinctBackupKeys) {
    throw new Error("Rollback backup verification failed");
  }

  const result = await context.client.query(
    `UPDATE customers c
        SET lifecycle_status = b.previous_values->>'lifecycleStatus'
       FROM application_migration_backups b
      WHERE b.migration_id = $1
        AND b.backup_key = c.id::text
        AND c.lifecycle_status IS DISTINCT FROM b.previous_values->>'lifecycleStatus'`,
    [ACCOUNT_LIFECYCLE_V1_ID],
  );
  return {
    backupRows,
    restoredRows: result.rowCount ?? 0,
  };
}

export const accountLifecycleV1Migration: MigrationDefinition<AccountLifecyclePreflight> = {
  id: ACCOUNT_LIFECYCLE_V1_ID,
  checksum: ACCOUNT_LIFECYCLE_V1_CHECKSUM,
  description: "Normalize customer lifecycle_status from the legacy status field",
  required: true,
  preflight,
  backup,
  apply,
  postflight,
  verify: readVerification,
  rollback,
};

export { lifecycleForStatus, SUPPORTED_ACCOUNT_TYPES, SUPPORTED_LIFECYCLE_STATUSES };