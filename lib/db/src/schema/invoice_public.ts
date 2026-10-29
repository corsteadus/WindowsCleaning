import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * A3 (Kyle, Video 7): the customer's own page for an invoice, its PDF, and which
 * address opened it. Like an estimate's: a secret link (only its hash is kept),
 * each address it is emailed to with its own key, and the invoice's history.
 * The page always shows the invoice as it stands now — what is paid and owed.
 */
export const invoicePublicLinksTable = pgTable("invoice_public_links", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdBy: varchar("created_by"),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  /** Opens with no recipient key (a copied link), and when the office was last told of one. */
  openCount: integer("open_count").notNull().default(0),
  openNotifiedAt: timestamp("open_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("invoice_public_links_token_hash_idx").on(t.tokenHash),
  index("invoice_public_links_invoice_idx").on(t.invoiceId),
]);

export const invoiceDeliveriesTable = pgTable("invoice_deliveries", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  publicLinkId: integer("public_link_id").notNull(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status").notNull().default("sending"),
  lastError: text("last_error"),
  requestedBy: varchar("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  openKeyHash: text("open_key_hash"),
  openCount: integer("open_count").notNull().default(0),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  openNotifiedAt: timestamp("open_notified_at", { withTimezone: true }),
}, (t) => [
  index("invoice_deliveries_invoice_idx").on(t.invoiceId, t.requestedAt),
  uniqueIndex("invoice_deliveries_open_key_idx").on(t.openKeyHash),
]);

export const invoiceActivitiesTable = pgTable("invoice_activities", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  publicLinkId: integer("public_link_id"),
  activityType: text("activity_type").notNull(),
  detail: jsonb("detail"),
  actorType: text("actor_type").notNull().default("staff"),
  actorId: varchar("actor_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invoice_activities_invoice_time_idx").on(t.invoiceId, t.occurredAt)]);
