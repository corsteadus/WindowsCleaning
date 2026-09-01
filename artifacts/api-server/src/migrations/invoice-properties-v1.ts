import { createHash } from "node:crypto";
import type {
  MigrationContext,
  MigrationDefinition,
} from "./application-migrations.ts";

export const INVOICE_PROPERTIES_V1_ID = "invoice-properties-v1";

const MIGRATION_MANIFEST = [
  INVOICE_PROPERTIES_V1_ID,
  "add nullable invoices.property_id for new invoice property snapshots",
  "create an index for invoice property lookups",
  "leave all existing invoice property_id values NULL",
].join("\n");

export const INVOICE_PROPERTIES_V1_CHECKSUM = createHash("sha256")
  .update(MIGRATION_MANIFEST)
  .digest("hex");

type InvoicePropertiesPreflight = {
  invoiceCount: number;
  existingPropertyColumn: number;
};

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric migration result: ${key}`);
  return value;
}

async function columnPresent(context: MigrationContext): Promise<number> {
  const result = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'invoices'
        AND column_name = 'property_id'`,
  );
  return numberValue(result.rows[0] ?? {}, "count");
}

async function preflight(context: MigrationContext): Promise<InvoicePropertiesPreflight> {
  if (context.environment !== "sandbox") {
    throw new Error("Invoice property migration is Sandbox-only");
  }
  const invoices = await context.client.query("SELECT COUNT(*)::int AS count FROM invoices");
  return {
    invoiceCount: numberValue(invoices.rows[0] ?? {}, "count"),
    existingPropertyColumn: await columnPresent(context),
  };
}

async function backup(
  _context: MigrationContext,
  preflightResult: InvoicePropertiesPreflight,
): Promise<Record<string, unknown>> {
  // This migration is additive and intentionally does not rewrite or copy
  // historical invoice rows or either lifecycle backup table.
  return {
    invoiceCount: preflightResult.invoiceCount,
    backupRows: 0,
    historicalRowsRewritten: 0,
  };
}

async function apply(context: MigrationContext): Promise<Record<string, unknown>> {
  await context.client.query(
    `ALTER TABLE invoices
       ADD COLUMN IF NOT EXISTS property_id integer`,
  );
  await context.client.query(
    `CREATE INDEX IF NOT EXISTS idx_invoices_property_id
       ON invoices (property_id)`,
  );
  return { addedColumn: true, createdIndex: true };
}

async function postflight(
  context: MigrationContext,
  preflightResult: InvoicePropertiesPreflight,
): Promise<Record<string, unknown>> {
  const present = await columnPresent(context);
  if (present !== 1) throw new Error("invoices.property_id was not created");
  const rows = await context.client.query(
    "SELECT COUNT(*)::int AS count FROM invoices WHERE property_id IS NOT NULL",
  );
  const populatedRows = numberValue(rows.rows[0] ?? {}, "count");
  if (preflightResult.existingPropertyColumn === 0 && populatedRows !== 0) {
    throw new Error("Invoice property migration changed historical invoice rows");
  }
  return {
    invoiceCount: preflightResult.invoiceCount,
    populatedRows,
    historicalRowsRewritten: 0,
  };
}

async function verify(context: MigrationContext): Promise<Record<string, unknown>> {
  const present = await columnPresent(context);
  if (present !== 1) throw new Error("invoices.property_id is missing");
  return { propertyColumnPresent: true };
}

async function rollback(context: MigrationContext): Promise<Record<string, unknown>> {
  await context.client.query("DROP INDEX IF EXISTS idx_invoices_property_id");
  await context.client.query("ALTER TABLE invoices DROP COLUMN IF EXISTS property_id");
  return { removedColumn: true };
}

export const invoicePropertiesV1Migration: MigrationDefinition<InvoicePropertiesPreflight> = {
  id: INVOICE_PROPERTIES_V1_ID,
  checksum: INVOICE_PROPERTIES_V1_CHECKSUM,
  description: "Add nullable invoice property snapshots without historical backfill",
  required: true,
  preflight,
  backup,
  apply,
  postflight,
  verify,
  rollback,
};