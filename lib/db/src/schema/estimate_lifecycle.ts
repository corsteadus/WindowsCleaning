import {
  boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";

export const estimateAppointmentsTable = pgTable("estimate_appointments", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  assignedUserId: varchar("assigned_user_id"),
  appointmentNotes: text("appointment_notes"),
  estimateNotes: text("estimate_notes"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("estimate_appointments_quote_idx").on(t.quoteId),
  index("estimate_appointments_schedule_idx").on(t.startsAt, t.assignedUserId),
]);

export const estimateLocationsTable = pgTable("estimate_locations", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  propertyId: integer("property_id").notNull(),
  locationNotes: text("location_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("estimate_locations_quote_property_idx").on(t.quoteId, t.propertyId)]);

export const estimateLineMetadataTable = pgTable("estimate_line_metadata", {
  lineItemId: integer("line_item_id").primaryKey(),
  propertyId: integer("property_id"),
  isUpsell: boolean("is_upsell").notNull().default(false),
  serviceNotes: text("service_notes"),
});

export const estimateRevisionsTable = pgTable("estimate_revisions", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  finalizedBy: varchar("finalized_by"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("estimate_revisions_quote_number_idx").on(t.quoteId, t.revisionNumber),
  index("estimate_revisions_quote_idx").on(t.quoteId, t.id),
]);

export const estimatePublicLinksTable = pgTable("estimate_public_links", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  revisionId: integer("revision_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  sendMethods: text("send_methods").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  decision: text("decision"),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  followUpRequested: boolean("follow_up_requested").notNull().default(false),
  acceptedSnapshot: jsonb("accepted_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("estimate_public_links_token_hash_idx").on(t.tokenHash),
  index("estimate_public_links_quote_idx").on(t.quoteId, t.sentAt),
  index("estimate_public_links_decision_at_idx").on(t.decisionAt),
]);

export const estimateDeliveryRequestsTable = pgTable("estimate_delivery_requests", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  publicLinkId: integer("public_link_id").notNull(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  status: text("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  requestedBy: varchar("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index("estimate_delivery_requests_quote_idx").on(t.quoteId, t.requestedAt)]);

export const estimateActivitiesTable = pgTable("estimate_activities", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull(),
  publicLinkId: integer("public_link_id"),
  activityType: text("activity_type").notNull(),
  detail: jsonb("detail"),
  actorType: text("actor_type").notNull().default("staff"),
  actorId: varchar("actor_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("estimate_activities_quote_time_idx").on(t.quoteId, t.occurredAt),
  index("estimate_activities_type_time_idx").on(t.activityType, t.occurredAt),
]);
