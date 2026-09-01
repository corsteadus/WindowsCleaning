import { pgTable, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoiceJobsTable = pgTable("invoice_jobs", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  jobId: integer("job_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_invoice_jobs_invoice_job").on(t.invoiceId, t.jobId),
  index("idx_invoice_jobs_invoice_id").on(t.invoiceId),
  index("idx_invoice_jobs_job_id").on(t.jobId),
]);

export const insertInvoiceJobSchema = createInsertSchema(invoiceJobsTable).omit({ id: true, createdAt: true });
export type InsertInvoiceJob = z.infer<typeof insertInvoiceJobSchema>;
export type InvoiceJob = typeof invoiceJobsTable.$inferSelect;