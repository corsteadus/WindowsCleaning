import { pgTable, serial, text, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";

export const customerCreditApplicationsTable = pgTable("customer_credit_applications", {
  id: serial("id").primaryKey(),
  sourceKey: text("source_key").notNull(),
  customerId: integer("customer_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  origin: text("origin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
}, (t) => [
  index("idx_customer_credit_applications_source").on(t.sourceKey),
  index("idx_customer_credit_applications_customer").on(t.customerId),
  index("idx_customer_credit_applications_invoice").on(t.invoiceId),
]);

export type CustomerCreditApplication = typeof customerCreditApplicationsTable.$inferSelect;