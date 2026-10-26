import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { propertiesTable } from "./properties.ts";

export const attachmentsTable = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),   // "customer" | "lead"
  entityId: integer("entity_id").notNull(),
  objectPath: text("object_path").notNull(),    // /objects/uploads/...
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),        // MIME type
  fileSize: integer("file_size"),               // bytes
  // The location a file belongs to (phase 3); null = the profile as a whole.
  propertyId: integer("property_id").references(() => propertiesTable.id, { onDelete: "set null" }),
  description: text("description"),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
