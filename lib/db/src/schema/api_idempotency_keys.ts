import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const apiIdempotencyKeysTable = pgTable(
  "api_idempotency_keys",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    operation: text("operation").notNull(),
    clientKey: text("client_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("in_progress"),
    resourceType: text("resource_type"),
    resourceId: integer("resource_id"),
    responseStatus: integer("response_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    scopeOperationClientKeyUnique: uniqueIndex("api_idempotency_keys_scope_operation_client_key_idx").on(
      table.scope,
      table.operation,
      table.clientKey,
    ),
  }),
);

export type ApiIdempotencyKey = typeof apiIdempotencyKeysTable.$inferSelect;
export type InsertApiIdempotencyKey = typeof apiIdempotencyKeysTable.$inferInsert;