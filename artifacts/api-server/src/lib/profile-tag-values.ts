/**
 * A5: every profile tag's value for one customer, read from the database — never
 * from what the screen sent, so a message can only say what the record says.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { customersTable, db, jobsTable, propertiesTable } from "@workspace/db";
import { readCompanyProfile } from "./company-profile.ts";
import { businessDateStr } from "./date.ts";
import { profileTagValues, type ProfileTag } from "./merge-tags.ts";

export interface ProfileForMessages {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  values: Record<ProfileTag, string>;
  /** Name, street, City ST ZIP, for the letter's address block. */
  mailingLines: string[];
}

export async function loadProfileForMessages(customerId: number, senderName: string | null): Promise<ProfileForMessages | null> {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
  if (!customer) return null;
  const properties = await db.select({
    id: propertiesTable.id, address: propertiesTable.address, city: propertiesTable.city, state: propertiesTable.state, zip: propertiesTable.zip, isPrimary: propertiesTable.isPrimary,
  }).from(propertiesTable).where(and(eq(propertiesTable.customerId, customerId), isNull(propertiesTable.archivedAt)));
  const place = properties.find((p) => p.id === customer.defaultPropertyId) ?? properties.find((p) => p.isPrimary) ?? properties[0];
  const [lastJob] = await db.select({ serviceType: jobsTable.serviceType, scheduledDate: jobsTable.scheduledDate, completedAt: jobsTable.completedAt })
    .from(jobsTable).where(and(eq(jobsTable.customerId, customerId), eq(jobsTable.status, "completed")))
    .orderBy(desc(jobsTable.scheduledDate)).limit(1);
  const business = await readCompanyProfile();
  const values = profileTagValues({
    customer: {
      ...customer,
      phone: customer.cellPhone || customer.homePhone || customer.phone || customer.workPhone,
    },
    serviceAddress: place ? [place.address, [place.city, [place.state, place.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : null,
    lastService: lastJob ? { type: lastJob.serviceType, date: lastJob.completedAt?.slice(0, 10) ?? lastJob.scheduledDate } : null,
    business,
    senderName,
    today: businessDateStr(),
  });
  const addressee = values.customer_name || values.full_name;
  const commercialContact = customer.clientType === "commercial" && values.company_name && values.full_name && values.full_name !== addressee
    ? `Attn: ${values.full_name}` : "";
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    values,
    mailingLines: [addressee, commercialContact, ...values.billing_address.split("\n")].filter(Boolean),
  };
}
