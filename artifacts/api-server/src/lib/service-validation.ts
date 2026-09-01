const CATEGORIES = new Set([
  "window_cleaning", "gutter_cleaning", "pressure_washing",
  "solar_panel_cleaning", "screen_cleaning", "add_on",
]);
const PRICING_UNITS = {
  flat: "service",
  per_window: "window",
  per_hour: "hour",
  per_sqft: "sq_ft",
} as const;

export type CanonicalServiceInput = {
  name: string;
  description: string | null;
  category: string;
  pricingType: string;
  basePrice: number;
  unit: string | null;
  estimatedDuration: number | null;
  isActive: boolean;
};

export function normalizeServiceInput(input: CanonicalServiceInput): CanonicalServiceInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    unit: input.unit ?? null,
    estimatedDuration: input.estimatedDuration ?? null,
  };
}

export function validateServiceInput(input: CanonicalServiceInput): string | null {
  if (!input.name) return "Service name is required";
  if (!CATEGORIES.has(input.category)) return "Service category is invalid";
  if (!(input.pricingType in PRICING_UNITS)) return "Pricing type is invalid";
  if (!Number.isFinite(input.basePrice) || input.basePrice < 0) return "Base price must be a finite nonnegative number";
  const expectedUnit = PRICING_UNITS[input.pricingType as keyof typeof PRICING_UNITS];
  if (input.unit !== expectedUnit) return `Unit must be ${expectedUnit} for ${input.pricingType} pricing`;
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