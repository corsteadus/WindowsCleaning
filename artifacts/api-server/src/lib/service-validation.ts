/**
 * What a service in the catalogue must look like.
 *
 * Kyle (Testing Edits, 2026-10-01, #8): *"Keep Service Name / Title and Category
 * as the core catalog information. Do not require or store a default price when
 * a service is created in the Service Catalog … The actual price should be
 * entered when the service is used on a specific quote or job."*
 *
 * So price, pricing type and unit are **optional**. They are not removed: a
 * service that already carries a price keeps it, and it is offered as a starting
 * figure on a quote rather than demanded up front.
 *
 * Categories are no longer a fixed list in this file — the business adds and
 * removes its own, so the caller passes the ones it knows about.
 */

/** Only meaningful when a pricing type is given at all. */
const PRICING_UNITS = {
  flat: "service",
  per_window: "window",
  per_hour: "hour",
  per_sqft: "sq_ft",
} as const;

export type ServicePricingType = keyof typeof PRICING_UNITS;

export function unitForPricingType(pricingType: string | null | undefined): string | null {
  if (!pricingType) return null;
  return PRICING_UNITS[pricingType as ServicePricingType] ?? null;
}

export function isKnownPricingType(value: unknown): value is ServicePricingType {
  return typeof value === "string" && value in PRICING_UNITS;
}

export type CanonicalServiceInput = {
  name: string;
  description: string | null;
  category: string;
  pricingType: string | null;
  basePrice: number | null;
  unit: string | null;
  estimatedDuration: number | null;
  isActive: boolean;
};

export function normalizeServiceInput(input: CanonicalServiceInput): CanonicalServiceInput {
  const pricingType = input.pricingType?.trim() || null;
  const basePrice = input.basePrice === null || input.basePrice === undefined ? null : input.basePrice;
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    category: input.category?.trim() ?? "",
    pricingType,
    basePrice,
    // The unit only ever describes the pricing type, so it follows it rather
    // than being asked for separately.
    unit: pricingType ? unitForPricingType(pricingType) : null,
    estimatedDuration: input.estimatedDuration ?? null,
  };
}

/**
 * `allowedCategories` is what the business has defined. Passing `null` means the
 * caller could not read them and any non-empty category is accepted, so a
 * catalogue problem never blocks somebody from saving their work.
 */
export function validateServiceInput(
  input: CanonicalServiceInput,
  allowedCategories: ReadonlySet<string> | null = null,
): string | null {
  if (!input.name) return "Service name is required";
  if (!input.category) return "Service category is required";
  if (allowedCategories && !allowedCategories.has(input.category)) {
    return "Service category is not one your company has defined";
  }
  if (input.pricingType !== null && !isKnownPricingType(input.pricingType)) {
    return "Pricing type is invalid";
  }
  if (input.basePrice !== null
    && (!Number.isFinite(input.basePrice) || input.basePrice < 0)) {
    return "Price must be a finite nonnegative number";
  }
  if (input.estimatedDuration !== null
    && (!Number.isInteger(input.estimatedDuration) || input.estimatedDuration < 0)) {
    return "Estimated duration must be a nonnegative whole number of minutes";
  }
  return null;
}

export function mergeServiceUpdate(
  existing: CanonicalServiceInput,
  update: Partial<CanonicalServiceInput>,
): CanonicalServiceInput {
  return normalizeServiceInput({ ...existing, ...update });
}
