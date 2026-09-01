import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityLogsTable = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // "customer" | "lead"
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),          // "status_changed" | "note_added" | "deactivated" | "reactivated" | "field_updated"
  fromValue: text("from_value"),
  toValue: text("to_value"),
  reason: text("reason"),
  note: text("note"),                        // used for note_added entries
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_activity_logs_entity").on(t.entityType, t.entityId),
  index("idx_activity_logs_created_at").on(t.createdAt),
]);

export const insertActivityLogSchema = createInsertSchema(activityLogsTable).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogsTable.$inferSelect;
