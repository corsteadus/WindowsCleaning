import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { crewsTable } from "./crews.ts";
import { usersTable } from "./auth.ts";

/**
 * Canonical crew assignment graph. Legacy crew display text deliberately
 * remains on crewsTable for backwards-compatible presentation only.
 */
export const crewMembersTable = pgTable("crew_members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  crewId: integer("crew_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("crew_members_crew_user_unique").on(table.crewId, table.userId),
  uniqueIndex("crew_members_one_lead_unique").on(table.crewId).where(sql`${table.role} = 'lead'`),
  index("crew_members_user_crew_idx").on(table.userId, table.crewId),
  index("crew_members_crew_role_idx").on(table.crewId, table.role),
  check("crew_members_role_check", sql`${table.role} IN ('lead', 'member')`),
  foreignKey({
    name: "crew_members_crew_id_crews_id_restrict_fk",
    columns: [table.crewId],
    foreignColumns: [crewsTable.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "crew_members_user_id_users_id_restrict_fk",
    columns: [table.userId],
    foreignColumns: [usersTable.id],
  }).onDelete("restrict"),
]);

export const insertCrewMemberSchema = createInsertSchema(crewMembersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewMember = typeof crewMembersTable.$inferSelect;