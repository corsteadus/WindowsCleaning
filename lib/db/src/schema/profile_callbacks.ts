import { pgTable, text, serial, timestamp, integer, varchar, index } from "drizzle-orm/pg-core";
import { customersTable } from "./customers.ts";
import { usersTable } from "./auth.ts";

/**
 * A callback to make to a prospect or customer — phase 4, Kyle's Video 4: "someone
 * in the office, or even a virtual assistant, going through a list and calling
 * customers or prospects." Each call is one row: when it is due and who makes it,
 * then, once made, whether they spoke, left a message or neither. The next
 * callback is a new row, so the history of attempts stays.
 */
export const profileCallbacksTable = pgTable("profile_callbacks", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  assignedUserId: varchar("assigned_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  reason: text("reason"),
  status: text("status").notNull().default("open"),     // open | done | cancelled
  outcome: text("outcome"),                             // spoke | left_message | no_answer
  outcomeNote: text("outcome_note"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("profile_callbacks_customer_idx").on(t.customerId),
  index("profile_callbacks_open_due_idx").on(t.status, t.dueAt),
]);

export type ProfileCallback = typeof profileCallbacksTable.$inferSelect;
