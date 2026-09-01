import { pgTable, text, serial, timestamp, integer, numeric, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  jobId: integer("job_id"),
  // Snapshot of the service property selected when the invoice was created.
  // Nullable to preserve historical invoices and invoices without a location.
  propertyId: integer("property_id"),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0"),
  balanceDue: numeric("balance_due", { precision: 10, scale: 2 }).notNull(),
  dueDate: text("due_date"),
  paidAt: text("paid_at"),
  notes: text("notes"),
  lineItems: text("line_items"),
  stripePaymentLink: text("stripe_payment_link"),
  stripePaymentLinkId: text("stripe_payment_link_id"),
  // Import tracking
  importSource: text("import_source"),
  importExternalId: text("import_external_id"),
  importBatchId: integer("import_batch_id"),
  isImported: boolean("is_imported").notNull().default(false),
  lastImportFingerprint: text("last_import_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_invoices_customer_id").on(t.customerId),
  index("idx_invoices_job_id").on(t.jobId),
  index("idx_invoices_property_id").on(t.propertyId),
  index("idx_invoices_status").on(t.status),
  index("idx_invoices_created_at").on(t.createdAt),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
