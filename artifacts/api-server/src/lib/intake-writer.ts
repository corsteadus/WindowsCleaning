import { and, eq } from "drizzle-orm";
import {
  accountProfileSettingsTable,
  contactChannelPurposesTable,
  contactChannelsTable,
  contactsTable,
  profileCatalogItemsTable,
  propertiesTable,
  propertyAccountRelationshipsTable,
} from "@workspace/db";
import type { IntakePlan } from "./intake.ts";

/**
 * Write an intake (lib/intake.ts) for a customer just inserted, inside the
 * caller's transaction. Phones and emails become contact channels — the
 * source the profile page edits — named people become contacts, and extra
 * locations become properties the account owns. The flat columns were
 * already set from the same intake, so nothing needs mirroring here.
 */
export async function writeIntake(
  tx: any,
  customer: { id: number; clientType?: string | null },
  plan: IntakePlan,
): Promise<{ locationIds: number[] }> {
  const contactIds = new Map<string, number>();
  for (const person of plan.people) {
    const [contact] = await tx.insert(contactsTable).values({
      customerId: customer.id,
      firstName: person.firstName,
      lastName: person.lastName,
      isPrimary: false,
    }).returning({ id: contactsTable.id });
    contactIds.set(person.key, contact.id);
  }
  const owner = (key: string | null) => (key ? contactIds.get(key) ?? null : null);

  for (const phone of plan.phones) {
    await tx.insert(contactChannelsTable).values({
      customerId: customer.id,
      contactId: owner(phone.personKey),
      channelType: "phone",
      label: phone.slot,
      value: phone.value,
      isPrimary: false,
    });
  }

  for (const [index, email] of plan.emails.entries()) {
    const [channel] = await tx.insert(contactChannelsTable).values({
      customerId: customer.id,
      contactId: owner(email.personKey),
      channelType: "email",
      label: "Email",
      value: email.value,
      // The first is the account's own; the mirror keeps the flat column on it.
      isPrimary: index === 0,
    }).returning({ id: contactChannelsTable.id });
    // None (#7) is no rows at all.
    if (email.purposes.length) {
      await tx.insert(contactChannelPurposesTable).values(
        email.purposes.map((purpose) => ({ channelId: channel.id, purpose })),
      );
    }
  }

  const locationIds: number[] = [];
  for (const location of plan.locations) {
    const [property] = await tx.insert(propertiesTable).values({
      customerId: customer.id,
      name: location.name,
      address: location.address,
      city: location.city,
      state: location.state,
      zip: location.zip,
      propertyType: customer.clientType ?? "residential",
      isPrimary: false,
      isManualDefault: false,
      isBillingAddress: false,
    }).returning({ id: propertiesTable.id });
    await tx.insert(propertyAccountRelationshipsTable).values({
      propertyId: property.id,
      customerId: customer.id,
      relationshipType: "owner",
      isPrimary: false,
    });
    locationIds.push(property.id);
  }

  if (plan.marketingSource) {
    // The same pairing Profile Details writes: the catalogue id here, the
    // name on customers.source (already set from the intake).
    const [source] = await tx.select({ id: profileCatalogItemsTable.id }).from(profileCatalogItemsTable)
      .where(and(
        eq(profileCatalogItemsTable.catalogType, "marketing_source"),
        eq(profileCatalogItemsTable.name, plan.marketingSource),
      ));
    if (source) {
      await tx.insert(accountProfileSettingsTable).values({ customerId: customer.id, marketingSourceId: source.id })
        .onConflictDoUpdate({
          target: accountProfileSettingsTable.customerId,
          set: { marketingSourceId: source.id, updatedAt: new Date() },
        });
    }
  }
  return { locationIds };
}
