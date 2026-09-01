import { and, asc, eq, isNull, ne } from "drizzle-orm";
import {
  contactsTable,
  customersTable,
  propertiesTable,
  propertyAccountRelationshipsTable,
} from "@workspace/db";

export const ACCOUNT_RELATIONSHIP_LOCK_CLASS_ID = 4;

export type AccountRelationExecutor = any;

export async function lockAccount(
  executor: AccountRelationExecutor,
  customerId: number,
): Promise<void> {
  await executor.execute(
    `SELECT pg_advisory_xact_lock(${ACCOUNT_RELATIONSHIP_LOCK_CLASS_ID}, ${customerId})`,
  );
}

export async function requireCustomer(
  executor: AccountRelationExecutor,
  customerId: number,
): Promise<Record<string, unknown>> {
  const [customer] = await executor
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) throw new AccountRelationError(404, "Customer not found");
  return customer;
}

/**
 * A property may be selected for an account only while the property is active
 * and the account has an active owner/shared relationship to it. Historical
 * jobs, quotes, and plans may still retain null property ids; this helper is
 * only for new selections or explicit property changes.
 */
export async function requireActivePropertyForCustomer(
  executor: AccountRelationExecutor,
  customerId: number,
  propertyId: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new AccountRelationError(400, "customerId must be a positive integer");
  }
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new AccountRelationError(400, "propertyId must be a positive integer");
  }

  const [property] = await executor
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!property) throw new AccountRelationError(404, "Property not found");
  if (property.archivedAt) {
    throw new AccountRelationError(409, "Archived properties cannot be selected");
  }

  if (property.customerId === customerId) return property;

  const [relationship] = await executor
    .select({ id: propertyAccountRelationshipsTable.id })
    .from(propertyAccountRelationshipsTable)
    .where(and(
      eq(propertyAccountRelationshipsTable.propertyId, propertyId),
      eq(propertyAccountRelationshipsTable.customerId, customerId),
      isNull(propertyAccountRelationshipsTable.archivedAt),
    ));
  if (!relationship) {
    throw new AccountRelationError(409, "Property is not actively related to this customer");
  }
  return property;
}

export async function effectiveDefaultPropertyIdForCustomer(
  executor: AccountRelationExecutor,
  customerId: number,
): Promise<number | null> {
  const [customer] = await executor
    .select({ defaultPropertyId: customersTable.defaultPropertyId })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) throw new AccountRelationError(404, "Customer not found");

  const [owned, shared] = await Promise.all([
    executor
      .select({
        id: propertiesTable.id,
        isPrimary: propertiesTable.isPrimary,
        isBillingAddress: propertiesTable.isBillingAddress,
      })
      .from(propertiesTable)
      .where(and(
        eq(propertiesTable.customerId, customerId),
        isNull(propertiesTable.archivedAt),
      )),
    executor
      .select({
        id: propertiesTable.id,
        isPrimary: propertyAccountRelationshipsTable.isPrimary,
        isBillingAddress: propertiesTable.isBillingAddress,
      })
      .from(propertiesTable)
      .innerJoin(
        propertyAccountRelationshipsTable,
        eq(propertyAccountRelationshipsTable.propertyId, propertiesTable.id),
      )
      .where(and(
        eq(propertyAccountRelationshipsTable.customerId, customerId),
        isNull(propertiesTable.archivedAt),
        isNull(propertyAccountRelationshipsTable.archivedAt),
      )),
  ]);
  const active = [...owned, ...shared].sort((a, b) => a.id - b.id);
  if (customer.defaultPropertyId != null && active.some((property) => property.id === customer.defaultPropertyId)) {
    return customer.defaultPropertyId;
  }
  return active.find((property) => property.isPrimary)?.id
    ?? active.find((property) => property.isBillingAddress)?.id
    ?? active[0]?.id
    ?? null;
}

export class AccountRelationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AccountRelationError";
  }
}

export function normalizeOptionalPropertyId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const propertyId = Number(value);
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new AccountRelationError(400, "propertyId must be a positive integer");
  }
  return propertyId;
}

export interface LegacyContactFields {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
  cellPhone?: string | null;
  altPhone?: string | null;
  alternatePhone?: string | null;
}

export interface LegacyPropertyFields {
  billingAddress?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

export function canonicalContactValues(legacy: LegacyContactFields): {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  alternatePhone: string | null;
} | null {
  const firstName = clean(legacy.firstName);
  const lastName = clean(legacy.lastName);
  if (!firstName || !lastName) return null;
  return {
    firstName,
    lastName,
    email: clean(legacy.email),
    phone: clean(legacy.cellPhone) ?? clean(legacy.phone) ?? clean(legacy.homePhone) ?? clean(legacy.workPhone),
    alternatePhone: clean(legacy.alternatePhone) ?? clean(legacy.altPhone),
  };
}

export function canonicalPropertyValues(legacy: LegacyPropertyFields): {
  address: string;
  city: string;
  state: string;
  zip: string;
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
} | null {
  const address = clean(legacy.billingAddress);
  const city = clean(legacy.billingCity);
  const state = clean(legacy.billingState);
  const zip = clean(legacy.billingZip);
  if (!address || !city || !state || !zip) return null;
  return {
    address,
    city,
    state,
    zip,
    billingAddress: address,
    billingCity: city,
    billingState: state,
    billingZip: zip,
  };
}

/**
 * One-way legacy → canonical synchronization. This intentionally does not
 * call syncLegacyContact/syncLegacyProperty, so customer PATCH cannot create
 * a write loop with canonical edits.
 */
export async function syncPrimaryContactFromLegacy(
  executor: AccountRelationExecutor,
  customerId: number,
  legacy: LegacyContactFields,
): Promise<Record<string, unknown> | null> {
  const values = canonicalContactValues(legacy);
  if (!values) return null;
  const [primary] = await executor
    .select()
    .from(contactsTable)
    .where(and(
      eq(contactsTable.customerId, customerId),
      isNull(contactsTable.archivedAt),
      eq(contactsTable.isPrimary, true),
    ));
  if (!primary) return null;

  const changed = Object.entries(values).some(([key, value]) =>
    primary[key as keyof typeof primary] !== value,
  );
  if (!changed) return primary;
  const [updated] = await executor
    .update(contactsTable)
    .set(values)
    .where(eq(contactsTable.id, primary.id))
    .returning();
  return updated ?? primary;
}

/**
 * Billing edits only flow into an active primary property when that property
 * is explicitly marked as the billing address. This prevents a legacy billing
 * edit from overwriting a separate service location or a shared property's
 * owner data.
 */
export async function syncPrimaryPropertyFromLegacy(
  executor: AccountRelationExecutor,
  customerId: number,
  legacy: LegacyPropertyFields,
): Promise<Record<string, unknown> | null> {
  const values = canonicalPropertyValues(legacy);
  if (!values) return null;
  const [primary] = await executor
    .select()
    .from(propertiesTable)
    .where(and(
      eq(propertiesTable.customerId, customerId),
      isNull(propertiesTable.archivedAt),
      eq(propertiesTable.isPrimary, true),
      eq(propertiesTable.isBillingAddress, true),
    ));
  if (!primary) return null;

  const changed = Object.entries(values).some(([key, value]) =>
    primary[key as keyof typeof primary] !== value,
  );
  if (!changed) return primary;
  const [updated] = await executor
    .update(propertiesTable)
    .set(values)
    .where(eq(propertiesTable.id, primary.id))
    .returning();
  return updated ?? primary;
}

export async function syncLegacyContact(
  executor: AccountRelationExecutor,
  contact: {
    customerId: number;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    alternatePhone: string | null;
  },
): Promise<void> {
  await executor
    .update(customersTable)
    .set({
      // Account identity belongs to the account. A primary contact is a
      // communication relationship, not a rename of the account heading.
      email: contact.email,
      phone: contact.phone,
      cellPhone: contact.phone,
      alternatePhone: contact.alternatePhone,
      altPhone: contact.alternatePhone,
    })
    .where(eq(customersTable.id, contact.customerId));
}

export async function syncLegacyProperty(
  executor: AccountRelationExecutor,
  property: {
    id: number;
    customerId: number;
    address: string;
    city: string;
    state: string;
    zip: string;
    billingAddress?: string | null;
    billingCity?: string | null;
    billingState?: string | null;
    billingZip?: string | null;
    isBillingAddress: boolean;
  },
): Promise<void> {
  const updateData: Record<string, unknown> = { defaultPropertyId: property.id };
  if (property.isBillingAddress) {
    updateData.billingAddress = property.billingAddress ?? property.address;
    updateData.billingCity = property.billingCity ?? property.city;
    updateData.billingState = property.billingState ?? property.state;
    updateData.billingZip = property.billingZip ?? property.zip;
  }
  await executor
    .update(customersTable)
    .set(updateData)
    .where(eq(customersTable.id, property.customerId));
}

export async function promoteContact(
  executor: AccountRelationExecutor,
  contactId: number,
): Promise<Record<string, unknown>> {
  const [contact] = await executor
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId));
  if (!contact) throw new AccountRelationError(404, "Contact not found");
  if (contact.archivedAt) throw new AccountRelationError(409, "Archived contacts cannot be primary");

  await lockAccount(executor, contact.customerId);
  await executor
    .update(contactsTable)
    .set({ isPrimary: false })
    .where(
      and(
        eq(contactsTable.customerId, contact.customerId),
        isNull(contactsTable.archivedAt),
        ne(contactsTable.id, contactId),
      ),
    );
  const [updated] = await executor
    .update(contactsTable)
    .set({ isPrimary: true })
    .where(eq(contactsTable.id, contactId))
    .returning();
  await syncLegacyContact(executor, updated);
  return updated;
}

export async function promoteOwnerProperty(
  executor: AccountRelationExecutor,
  propertyId: number,
  customerId: number,
): Promise<Record<string, unknown>> {
  const [property] = await executor
    .select()
    .from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.customerId, customerId)));
  if (!property) throw new AccountRelationError(404, "Property not found for this customer");
  if (property.archivedAt) throw new AccountRelationError(409, "Archived properties cannot be primary");

  await lockAccount(executor, customerId);
  await executor
    .update(propertiesTable)
    .set({ isPrimary: false })
    .where(
      and(
        eq(propertiesTable.customerId, customerId),
        isNull(propertiesTable.archivedAt),
        ne(propertiesTable.id, propertyId),
      ),
    );
  const [updated] = await executor
    .update(propertiesTable)
    .set({ isPrimary: true })
    .where(eq(propertiesTable.id, propertyId))
    .returning();
  await syncLegacyProperty(executor, updated);
  return updated;
}

export async function promoteRelationshipProperty(
  executor: AccountRelationExecutor,
  propertyId: number,
  customerId: number,
): Promise<Record<string, unknown>> {
  const [relationship] = await executor
    .select()
    .from(propertyAccountRelationshipsTable)
    .where(
      and(
        eq(propertyAccountRelationshipsTable.propertyId, propertyId),
        eq(propertyAccountRelationshipsTable.customerId, customerId),
        isNull(propertyAccountRelationshipsTable.archivedAt),
      ),
    );
  if (!relationship) throw new AccountRelationError(404, "Property is not linked to this customer");

  await lockAccount(executor, customerId);
  await executor
    .update(propertyAccountRelationshipsTable)
    .set({ isPrimary: false })
    .where(
      and(
        eq(propertyAccountRelationshipsTable.customerId, customerId),
        isNull(propertyAccountRelationshipsTable.archivedAt),
        ne(propertyAccountRelationshipsTable.id, relationship.id),
      ),
    );
  const [updated] = await executor
    .update(propertyAccountRelationshipsTable)
    .set({ isPrimary: true })
    .where(eq(propertyAccountRelationshipsTable.id, relationship.id))
    .returning();
  const [property] = await executor
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (property?.customerId === customerId) {
    await executor
      .update(propertiesTable)
      .set({ isPrimary: true })
      .where(eq(propertiesTable.id, propertyId));
    await syncLegacyProperty(executor, property);
  }
  return updated;
}

export async function findReplacementContact(
  executor: AccountRelationExecutor,
  customerId: number,
  excludedId: number,
): Promise<Record<string, unknown> | null> {
  const [replacement] = await executor
    .select()
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.customerId, customerId),
        isNull(contactsTable.archivedAt),
        ne(contactsTable.id, excludedId),
      ),
    )
    .orderBy(asc(contactsTable.id))
    .limit(1);
  return replacement ?? null;
}

export async function findReplacementProperty(
  executor: AccountRelationExecutor,
  customerId: number,
  excludedId: number,
): Promise<Record<string, unknown> | null> {
  const [replacement] = await executor
    .select()
    .from(propertiesTable)
    .where(
      and(
        eq(propertiesTable.customerId, customerId),
        isNull(propertiesTable.archivedAt),
        ne(propertiesTable.id, excludedId),
      ),
    )
    .orderBy(asc(propertiesTable.id))
    .limit(1);
  return replacement ?? null;
}