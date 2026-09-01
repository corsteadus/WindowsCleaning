import { and, eq, sql } from "drizzle-orm";
import {
  customerImportProvenanceTable,
  customersTable,
  db,
} from "@workspace/db";
import {
  findStrongDuplicateCandidatesForCustomer,
  normalizeEmail,
  normalizePhone,
  type DuplicateCandidate,
} from "../../lib/lead-duplicate-candidates.ts";

export type CustomerImportDecision =
  | "create"
  | "requires_review"
  | "idempotent_skip";

export interface CustomerImportPreview {
  rowIndex: number;
  sourceSystem: string;
  externalRecordId: string | null;
  idempotencyAvailable: boolean;
  idempotencyWarning: string | null;
  decision: CustomerImportDecision;
  existingCustomerId: number | null;
  candidates: Array<DuplicateCandidate & { canLink: boolean }>;
}

export interface CustomerImportProvenanceReservation {
  customerId: number;
  reused: boolean;
}

export function normalizeImportIdentity(value: unknown): string {
  return String(value ?? "").trim().slice(0, 200);
}

export function customerContactFromNormalized(row: Record<string, unknown>) {
  return {
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    homePhone: typeof row.homePhone === "string" ? row.homePhone : null,
    workPhone: typeof row.workPhone === "string" ? row.workPhone : null,
    cellPhone: typeof row.cellPhone === "string" ? row.cellPhone : null,
    altPhone: typeof row.altPhone === "string" ? row.altPhone : null,
    alternatePhone: typeof row.alternatePhone === "string" ? row.alternatePhone : null,
  };
}

function contactSignals(row: Record<string, unknown>): string[] {
  const contact = customerContactFromNormalized(row);
  return Array.from(new Set([
    normalizeEmail(contact.email),
    contact.phone,
    contact.homePhone,
    contact.workPhone,
    contact.cellPhone,
    contact.altPhone,
    contact.alternatePhone,
  ].map((value) => {
    if (value === null || value === undefined) return null;
    if (value === contact.email) return normalizeEmail(String(value));
    return normalizePhone(String(value));
  }).filter((value): value is string => Boolean(value)))).sort();
}

export async function lockCustomerImportIdentity(
  executor: { execute: (query: unknown) => Promise<unknown> },
  sourceSystem: string,
  externalRecordId: string,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      5,
      hashtext(${`customer-import:${sourceSystem}:${externalRecordId}`})
    )
  `);
}

export async function findCustomerImportProvenance(
  executor: Pick<typeof db, "select">,
  sourceSystem: string,
  externalRecordId: string,
) {
  const [row] = await executor
    .select()
    .from(customerImportProvenanceTable)
    .where(and(
      eq(customerImportProvenanceTable.sourceSystem, sourceSystem),
      eq(customerImportProvenanceTable.externalRecordId, externalRecordId),
    ))
    .limit(1);
  return row ?? null;
}

export async function previewCustomerImportRows(
  executor: Pick<typeof db, "select">,
  sourceSystem: string,
  rows: Array<Record<string, unknown>>,
): Promise<CustomerImportPreview[]> {
  const normalizedSource = normalizeImportIdentity(sourceSystem);
  if (!normalizedSource) throw new Error("sourceSystem is required");

  return Promise.all(rows.map(async (row, rowIndex) => {
    const externalRecordId = normalizeImportIdentity(row.externalId ?? row.externalRecordId);
    const idempotencyAvailable = Boolean(externalRecordId);
    const provenance = idempotencyAvailable
      ? await findCustomerImportProvenance(executor, normalizedSource, externalRecordId)
      : null;

    if (provenance) {
      return {
        rowIndex,
        sourceSystem: normalizedSource,
        externalRecordId,
        idempotencyAvailable,
        idempotencyWarning: null,
        decision: "idempotent_skip" as const,
        existingCustomerId: provenance.customerId,
        candidates: [],
      };
    }

    const candidates = await findStrongDuplicateCandidatesForCustomer(
      executor,
      customerContactFromNormalized(row),
    );
    return {
      rowIndex,
      sourceSystem: normalizedSource,
      externalRecordId: externalRecordId || null,
      idempotencyAvailable,
      idempotencyWarning: idempotencyAvailable
        ? null
        : "No stable external record ID was provided; retry idempotency is unavailable.",
      decision: candidates.length > 0 ? "requires_review" as const : "create" as const,
      existingCustomerId: null,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        canLink: !["inactive", "archived"].includes(candidate.lifecycleStatus),
      })),
    };
  }));
}

export async function reserveCustomerImportProvenance(
  tx: any,
  sourceSystem: string,
  externalRecordId: string,
  customerId: number,
  importBatchId: number | null,
): Promise<CustomerImportProvenanceReservation> {
  await lockCustomerImportIdentity(tx, sourceSystem, externalRecordId);
  const existing = await findCustomerImportProvenance(tx, sourceSystem, externalRecordId);
  if (existing) {
    return { customerId: existing.customerId, reused: true };
  }

  const [created] = await tx.insert(customerImportProvenanceTable)
    .values({
      sourceSystem,
      externalRecordId,
      customerId,
      importBatchId,
    })
    .onConflictDoNothing({
      target: [
        customerImportProvenanceTable.sourceSystem,
        customerImportProvenanceTable.externalRecordId,
      ],
    })
    .returning();
  if (created) return { customerId, reused: false };

  const concurrent = await findCustomerImportProvenance(tx, sourceSystem, externalRecordId);
  if (!concurrent) throw new Error("Import identity could not be reserved");
  return { customerId: concurrent.customerId, reused: true };
}

export function customerImportContactSignals(row: Record<string, unknown>): string[] {
  return contactSignals(row);
}