import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Who the business is, as its customers see it — phase 8, Kyle's Video 6:
 * "businesses format their own estimate: what is shown, footer, terms, logo."
 * One row per organization, like the quote settings (which keep the terms).
 * The logo is kept here as a small JPEG — the browser converts and scales it
 * before upload — so the PDF can embed it and the customer's page and emails can
 * show it without the file store.
 */
export const companyProfileTable = pgTable("company_profile", {
  id: serial("id").primaryKey(),
  organizationKey: text("organization_key").notNull().default("default"),
  businessName: text("business_name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  /** Base64 JPEG, at most ~500 KB of image. */
  logoJpeg: text("logo_jpeg"),
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  /** Printed at the foot of every estimate page, e.g. licence and insurance numbers. */
  estimateFooter: text("estimate_footer"),
  showUnitPrices: boolean("show_unit_prices").notNull().default(true),
  showServiceDescriptions: boolean("show_service_descriptions").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("company_profile_org_idx").on(table.organizationKey),
  check("company_profile_logo_size_check", sql`${table.logoJpeg} IS NULL OR length(${table.logoJpeg}) <= 700000`),
  check("company_profile_footer_length_check", sql`${table.estimateFooter} IS NULL OR length(${table.estimateFooter}) <= 1000`),
]);

export type CompanyProfile = typeof companyProfileTable.$inferSelect;
