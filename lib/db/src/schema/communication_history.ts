import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { customersTable } from "./customers.ts";

/**
 * A6 (Kyle, Video 8): one communication history on the profile.
 * Migration communication-history-v1.
 */

/** A letter as it was printed, so the history can show it and print it again. */
export const printedLettersTable = pgTable("printed_letters", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  templateId: integer("template_id"),
  templateName: text("template_name"),
  subject: text("subject"),
  body: text("body").notNull(),
  recipientLines: jsonb("recipient_lines").$type<string[]>().notNull().default([]),
  printedBy: text("printed_by"),
  printedAt: timestamp("printed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("printed_letters_customer_idx").on(t.customerId, t.printedAt)]);

/**
 * An entry the owner or an admin removed from a profile's history. The record
 * itself is kept (it is evidence of what was sent); this hides it and says who
 * removed it and when.
 */
export const communicationDeletionsTable = pgTable("communication_deletions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  /** email = email_logs, message = message_logs, delivery = estimate_delivery_requests, letter = printed_letters. */
  source: text("source").notNull(),
  sourceId: integer("source_id").notNull(),
  summary: text("summary"),
  deletedBy: text("deleted_by"),
  deletedByUserId: text("deleted_by_user_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("communication_deletions_source_uq").on(t.source, t.sourceId),
  index("communication_deletions_customer_idx").on(t.customerId),
]);

export type PrintedLetter = typeof printedLettersTable.$inferSelect;
export type CommunicationDeletion = typeof communicationDeletionsTable.$inferSelect;
