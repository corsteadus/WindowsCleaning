import type {
  ServiceInputCategory,
  ServiceInputPricingType,
  ServiceInputUnit,
} from "@workspace/api-client-react";

export const SERVICE_CATEGORIES = [
  ["window_cleaning", "Window cleaning"], ["gutter_cleaning", "Gutter cleaning"],
  ["pressure_washing", "Pressure washing"], ["solar_panel_cleaning", "Solar panel cleaning"],
  ["screen_cleaning", "Screen cleaning"], ["add_on", "Add-on"],
] as const satisfies readonly (readonly [ServiceInputCategory, string])[];

export const SERVICE_PRICING = [
  ["flat", "Flat rate", "service"], ["per_window", "Per window", "window"],
  ["per_hour", "Per hour", "hour"], ["per_sqft", "Per sq. ft.", "sq_ft"],
] as const satisfies readonly (readonly [ServiceInputPricingType, string, Exclude<ServiceInputUnit, null | undefined>])[];

export type ServiceDraft = {
  name: string; description: string; category: ServiceInputCategory; pricingType: ServiceInputPricingType;
  basePrice: string; estimatedDuration: string; isActive: boolean;
};

export const emptyServiceDraft = (): ServiceDraft => ({
  name: "", description: "", category: "window_cleaning", pricingType: "flat",
  basePrice: "", estimatedDuration: "", isActive: true,
});

export function validateServiceDraft(draft: ServiceDraft): string | null {
  if (!draft.name.trim()) return "Service name is required.";
  const price = Number(draft.basePrice);
  if (!draft.basePrice.trim() || !Number.isFinite(price) || price < 0) return "Price must be a finite nonnegative number.";
  if (draft.estimatedDuration.trim()) {
    const duration = Number(draft.estimatedDuration);
    if (!Number.isInteger(duration) || duration < 0) return "Duration must be a nonnegative whole number of minutes.";
  }
  return null;
}

export function isServiceCategory(value: string): value is ServiceInputCategory {
  return SERVICE_CATEGORIES.some(([category]) => category === value);
}
export function isServicePricingType(value: string): value is ServiceInputPricingType {
  return SERVICE_PRICING.some(([pricingType]) => pricingType === value);
}
export function canSubmitService(isPending: boolean): boolean {
  return !isPending;
}

export function serviceIdempotencyHeaders(key: string): HeadersInit {
  return { "Idempotency-Key": key };
}