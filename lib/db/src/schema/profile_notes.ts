import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth.ts";
import { customersTable } from "./customers.ts";

/**
 * Dated, signed notes on a profile — profile redesign piece C.
 *
 * Kyle (answers of 2026-10-21): "Specific and callback notes: each entry dated
 * and signed; existing notes preserved." Each entry is kept as written; one can
 * be archived, not edited. The text that was in `customers.specific_notes` and
 * `customers.callback_notes` was carried in as each profile's first entry
 * (`carried_over`), by migrations/profile-note-entries-v1.ts, which creates
 * this table.
 */
export const profileNoteEntriesTable = pgTable("profile_note_entries", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** The name as it was when the note was written. */
  createdBy: text("created_by"),
  createdByUserId: varchar("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** Copied from the old single text box; its date and author were never recorded. */
  carriedOver: boolean("carried_over").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by"),
}, (table) => [
  check("profile_note_entries_kind_check", sql`${table.kind} IN ('specific', 'callback')`),
  check("profile_note_entries_body_check", sql`btrim(${table.body}) <> ''`),
  index("profile_note_entries_customer_idx").on(table.customerId, table.kind, table.createdAt.desc()),
]);

export type ProfileNoteEntry = typeof profileNoteEntriesTable.$inferSelect;
