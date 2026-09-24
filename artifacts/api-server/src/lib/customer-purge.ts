/**
 * Erasing a profile, and everything that belongs to it.
 *
 * Kyle (2026-09-23, #3): "If an authorized user deletes the entire prospect or
 * customer profile, permanently erase that profile and everything belonging to
 * it, including jobs, estimates/quotes, invoices, related payment records,
 * notes and history. This means deletion, not archiving."
 *
 * Almost none of these tables has a foreign key to `customers`, so nothing
 * cascades on its own — every table is listed here, children before parents.
 * The order matters and the list is the only place it is written down, so it is
 * data rather than a long function, and the tests below it can check both.
 *
 * `REMAINING_REFERENCE_CHECKS` is the safety net: after the deletes run, the
 * route counts what is left. Anything above zero means a table was missed, and
 * the transaction is rolled back rather than leaving half a customer behind.
 */

export interface PurgeStep {
  /** Table the statement deletes from. */
  table: string;
  /** SQL predicate; `:id` is replaced with the customer id. */
  where: string;
  /** Why this table belongs to the customer, for anyone reading the order. */
  note?: string;
}

const JOBS = "(SELECT id FROM jobs WHERE customer_id = :id)";
const QUOTES = "(SELECT id FROM quotes WHERE customer_id = :id)";
const INVOICES = "(SELECT id FROM invoices WHERE customer_id = :id)";
const PAYMENTS = "(SELECT id FROM payments WHERE customer_id = :id)";
const CHANNELS = "(SELECT id FROM contact_channels WHERE customer_id = :id)";
const CREDIT_NOTES = `(SELECT id FROM invoice_credit_notes WHERE invoice_id IN ${INVOICES})`;

/** Every history table keyed by an entity type and id rather than a customer id. */
const entityScoped = (typeColumn: string, idColumn: string) => [
  `(${typeColumn} = 'customer' AND ${idColumn} = :id)`,
  `(${typeColumn} IN ('job', 'jobs') AND ${idColumn} IN ${JOBS})`,
  `(${typeColumn} IN ('quote', 'quotes', 'estimate') AND ${idColumn} IN ${QUOTES})`,
  `(${typeColumn} IN ('invoice', 'invoices') AND ${idColumn} IN ${INVOICES})`,
].join(" OR ");

export const CUSTOMER_PURGE_ORDER: readonly PurgeStep[] = [
  // ── money: allocations, credits, then the documents they point at ────────
  { table: "payment_allocations", where: `payment_id IN ${PAYMENTS} OR invoice_id IN ${INVOICES}` },
  { table: "customer_credit_applications", where: "customer_id = :id" },
  { table: "customer_credit_refunds", where: "customer_id = :id" },
  { table: "customer_credit_sources", where: "customer_id = :id" },
  { table: "invoice_credit_lines", where: `credit_note_id IN ${CREDIT_NOTES} OR job_id IN ${JOBS}` },
  { table: "invoice_credit_notes", where: `invoice_id IN ${INVOICES}` },
  { table: "invoice_voids", where: `invoice_id IN ${INVOICES}` },
  { table: "invoice_reissues", where: `source_invoice_id IN ${INVOICES} OR replacement_invoice_id IN ${INVOICES}` },
  { table: "invoice_lines", where: `invoice_id IN ${INVOICES} OR job_id IN ${JOBS}` },
  { table: "invoice_jobs", where: `invoice_id IN ${INVOICES} OR job_id IN ${JOBS}` },
  { table: "payments", where: "customer_id = :id" },
  { table: "invoices", where: `customer_id = :id OR job_id IN ${JOBS}` },

  // ── work ─────────────────────────────────────────────────────────────────
  { table: "schedule_entries", where: `job_id IN ${JOBS}` },
  { table: "jobs", where: "customer_id = :id" },

  // ── estimates and everything hanging off them ────────────────────────────
  { table: "estimate_activities", where: `quote_id IN ${QUOTES}` },
  { table: "estimate_delivery_requests", where: `quote_id IN ${QUOTES}` },
  { table: "estimate_public_links", where: `quote_id IN ${QUOTES}` },
  { table: "estimate_line_metadata", where: `line_item_id IN (SELECT id FROM quote_line_items WHERE quote_id IN ${QUOTES})` },
  { table: "estimate_locations", where: `quote_id IN ${QUOTES}` },
  { table: "estimate_appointments", where: `quote_id IN ${QUOTES}` },
  { table: "estimate_revisions", where: `quote_id IN ${QUOTES}` },
  { table: "quote_line_items", where: `quote_id IN ${QUOTES}` },
  { table: "quotes", where: "customer_id = :id" },
  { table: "recurring_plans", where: "customer_id = :id" },

  // ── contact details and profile settings ─────────────────────────────────
  { table: "contact_channel_purposes", where: `channel_id IN ${CHANNELS}` },
  { table: "contact_channels", where: "customer_id = :id" },
  { table: "communication_eligibility_decisions", where: "customer_id = :id" },
  { table: "communication_preference_history", where: "customer_id = :id" },
  { table: "communication_preferences", where: "customer_id = :id" },
  { table: "custom_field_values", where: "customer_id = :id" },
  { table: "account_profile_settings", where: "customer_id = :id" },
  { table: "customer_import_provenance", where: "customer_id = :id" },
  { table: "property_account_relationships", where: "customer_id = :id" },
  { table: "properties", where: "customer_id = :id" },
  { table: "contacts", where: "customer_id = :id" },

  // ── history, keyed by entity rather than customer ────────────────────────
  { table: "activity_logs", where: entityScoped("entity_type", "entity_id"), note: "notes and history" },
  { table: "attachments", where: entityScoped("entity_type", "entity_id") },
  { table: "email_logs", where: entityScoped("entity_type", "entity_id") },
  { table: "communication_events", where: entityScoped("aggregate_type", "aggregate_id") },

  // ── the profile itself, last ─────────────────────────────────────────────
  { table: "customers", where: "id = :id" },
];

/**
 * A converted lead keeps its own record; it just stops pointing at a customer
 * that no longer exists. This runs before the deletes.
 */
export const LEAD_UNLINK = "UPDATE leads SET converted_customer_id = NULL WHERE converted_customer_id = :id";

/** Run after the deletes: every count must be zero. */
export const REMAINING_REFERENCE_CHECKS: readonly PurgeStep[] = [
  { table: "customers", where: "id = :id" },
  { table: "jobs", where: "customer_id = :id" },
  { table: "quotes", where: "customer_id = :id" },
  { table: "invoices", where: "customer_id = :id" },
  { table: "payments", where: "customer_id = :id" },
  { table: "properties", where: "customer_id = :id" },
  { table: "contacts", where: "customer_id = :id" },
  { table: "contact_channels", where: "customer_id = :id" },
  { table: "custom_field_values", where: "customer_id = :id" },
  { table: "account_profile_settings", where: "customer_id = :id" },
  { table: "recurring_plans", where: "customer_id = :id" },
  { table: "activity_logs", where: "entity_type = 'customer' AND entity_id = :id" },
];

function withId(sql: string, customerId: number): string {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new Error("customerId must be a positive integer");
  }
  return sql.replaceAll(":id", String(customerId));
}

export function purgeStatements(customerId: number): string[] {
  return [
    withId(LEAD_UNLINK, customerId),
    ...CUSTOMER_PURGE_ORDER.map((step) => withId(`DELETE FROM ${step.table} WHERE ${step.where}`, customerId)),
  ];
}

/**
 * Deleting one estimate from the profile (Kyle, 2026-09-23 #3). The old route
 * removed the quote and its line items only, leaving revisions, public links,
 * appointments and activities behind. A job that came from the estimate keeps
 * its own record and simply stops pointing at one.
 */
export const QUOTE_PURGE_ORDER: readonly PurgeStep[] = [
  { table: "estimate_activities", where: "quote_id = :id" },
  { table: "estimate_delivery_requests", where: "quote_id = :id" },
  { table: "estimate_public_links", where: "quote_id = :id" },
  { table: "estimate_line_metadata", where: "line_item_id IN (SELECT id FROM quote_line_items WHERE quote_id = :id)" },
  { table: "estimate_locations", where: "quote_id = :id" },
  { table: "estimate_appointments", where: "quote_id = :id" },
  { table: "estimate_revisions", where: "quote_id = :id" },
  { table: "quote_line_items", where: "quote_id = :id" },
  { table: "quotes", where: "id = :id" },
];

export const JOB_QUOTE_UNLINK = "UPDATE jobs SET quote_id = NULL WHERE quote_id = :id";

export function quotePurgeStatements(quoteId: number): string[] {
  return [
    withId(JOB_QUOTE_UNLINK, quoteId),
    ...QUOTE_PURGE_ORDER.map((step) => withId(`DELETE FROM ${step.table} WHERE ${step.where}`, quoteId)),
  ];
}

/** Deleting one job from the profile. Its invoice, if any, blocks this. */
export const JOB_PURGE_ORDER: readonly PurgeStep[] = [
  { table: "schedule_entries", where: "job_id = :id" },
  { table: "jobs", where: "id = :id" },
];

export function jobPurgeStatements(jobId: number): string[] {
  return JOB_PURGE_ORDER.map((step) => withId(`DELETE FROM ${step.table} WHERE ${step.where}`, jobId));
}

export function remainingReferenceQuery(customerId: number): string {
  const parts = REMAINING_REFERENCE_CHECKS.map((check) =>
    withId(`SELECT '${check.table}' AS table_name, count(*)::int AS remaining FROM ${check.table} WHERE ${check.where}`, customerId));
  return parts.join(" UNION ALL ");
}
