import { pgTable, text, serial, timestamp, boolean, integer, index, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  // Phone fields
  phone: text("phone"),               // kept for back-compat (mapped to homePhone)
  homePhone: text("home_phone"),
  workPhone: text("work_phone"),
  cellPhone: text("cell_phone"),
  altPhone: text("alt_phone"),
  altPhoneType: text("alt_phone_type"),
  alternatePhone: text("alternate_phone"), // legacy
  // Address / location
  billingAddress: text("billing_address"),
  billingCity: text("billing_city"),
  billingState: text("billing_state"),
  billingZip: text("billing_zip"),
  county: text("county"),
  subdivision: text("subdivision"),
  // Flags
  isNonProfit: boolean("is_non_profit").notNull().default(false),
  ccFeeExempt: boolean("cc_fee_exempt").notNull().default(false),
  taxExempt: boolean("tax_exempt").notNull().default(false),
  // Contact prefs
  preferredContactMethod: text("preferred_contact_method"),
  sendingPreferences: text("sending_preferences"),  // e.g. "email,sms"
  // Custom window-cleaning fields
  windowCount: integer("window_count"),
  windowType: text("window_type"),
  houseSize: text("house_size"),
  laddersNeeded: text("ladders_needed"),
  // Company / business
  companyName: text("company_name"),
  fax: text("fax"),
  altContact: text("alt_contact"),
  starRating: integer("star_rating"),
  salutation: text("salutation"),
  // Marketing & classification
  source: text("source"),
  howHeard: text("how_heard"),
  tags: text("tags"),
  status: text("status").notNull().default("active"),
  lifecycleStatus: text("lifecycle_status").notNull().default("customer"),
  // Notes & directions
  notes: text("notes"),
  specificNotes: text("specific_notes"),
  callbackNotes: text("callback_notes"),
  directions: text("directions"),
  // Prospect / customer dates
  prospectDate: text("prospect_date"),
  customerDate: text("customer_date"),
  birthday: text("birthday"),
  // Client classification
  clientType: text("client_type").default("residential"),  // "residential" | "commercial"
  // Deactivation tracking
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivationReason: text("deactivation_reason"),
  deactivatedBy: text("deactivated_by"),
  // Import tracking
  importSource: text("import_source"),
  importExternalId: text("import_external_id"),
  importBatchId: integer("import_batch_id"),
  isImported: boolean("is_imported").notNull().default(false),
  isImportVerified: boolean("is_import_verified").notNull().default(false),
  lastSeenImportAt: timestamp("last_seen_import_at", { withTimezone: true }),
  lastImportFingerprint: text("last_import_fingerprint"),
  mergeReviewStatus: text("merge_review_status"),
  defaultPropertyId: integer("default_property_id"),
  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("idx_customers_last_name_first_name").on(t.lastName, t.firstName),
  index("idx_customers_status").on(t.status),
  index("idx_customers_lifecycle_status").on(t.lifecycleStatus),
  index("idx_customers_client_type").on(t.clientType),
  index("idx_customers_email").on(t.email),
  index("idx_customers_created_at").on(t.createdAt),
  check(
    "customers_lifecycle_status_check",
    sql`${t.lifecycleStatus} in ('prospect', 'customer', 'inactive', 'archived')`,
  ),
]);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
