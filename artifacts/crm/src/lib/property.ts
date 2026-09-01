/**
 * Canonical property display contract.
 *
 * Field names match the database schema (propertiesTable) and what
 * GET /properties returns directly. Legacy names that must NOT be used:
 *   addressLine1  →  address
 *   postalCode    →  zip
 *   nickname      →  name
 */
export interface PropertyLike {
  id: number;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  name?: string | null;
  customerId?: number;
  archivedAt?: string | null;
  relationshipType?: string | null;
  isOwner?: boolean;
  isPrimary?: boolean;
  isManualDefault?: boolean;
  isBillingAddress?: boolean;
}

export function propertyAddress(p: PropertyLike): string {
  return [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
}

export function propertyRelationshipLabel(p: PropertyLike): "Owned" | "Shared" {
  return p.isOwner === false || p.relationshipType === "shared" ? "Shared" : "Owned";
}

export function activePropertyChoices(properties: PropertyLike[]): PropertyLike[] {
  return properties.filter((property) => !property.archivedAt);
}

export function effectivePropertyId(properties: PropertyLike[], requestedId?: number | null): number | null {
  return requestedId != null && activePropertyChoices(properties).some((property) => property.id === requestedId)
    ? requestedId
    : null;
}

/**
 * Fields present on enriched job / quote / recurring-plan API responses.
 *
 * The API server adds propertyName (= properties.name) and propertyAddress
 * (= formatted address) alongside the raw propertyId.
 * DO NOT use propertyNickname — that name was removed from the contract.
 */
export interface JobPropertyFields {
  propertyId?: number | null;
  propertyName?: string | null;
  propertyAddress?: string | null;
}

/**
 * Returns the best human-readable label for the property on an enriched
 * job / quote / recurring-plan response.
 *
 * Priority: propertyName → propertyAddress → "Property #id" → null
 */
export function jobPropertyLabel(job: JobPropertyFields): string | null {
  return (
    job.propertyName ||
    job.propertyAddress ||
    (job.propertyId ? `Property #${job.propertyId}` : null)
  );
}

/**
 * Formats a property for dropdown labels and display strings.
 *
 * Behaviour:
 *   - Joins address, city, state, zip with ", " skipping null/undefined/empty.
 *   - If name is set: "Name — addr" (or just "Name" when no address parts).
 *   - If no name: addr string, or "Property #id" when all parts blank.
 *
 * Does NOT read addressLine1, postalCode, or nickname.
 */
export function propertyLabel(p: PropertyLike): string {
  const addr = propertyAddress(p);
  if (p.name) return addr ? `${p.name} — ${addr}` : p.name;
  return addr || `Property #${p.id}`;
}
