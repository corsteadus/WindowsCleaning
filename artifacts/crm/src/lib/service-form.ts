import type {
  ServiceInput,
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

export function newServiceIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function serviceIdempotencyHeaders(key: string): HeadersInit {
  return { "Idempotency-Key": key };
}

/**
 * The catalogue request body for a draft, or the reason it cannot be sent.
 * Shared by the Service Catalog page and the quick-add used on quotes and jobs,
 * so a service added from either place is stored exactly the same way.
 */
export function serviceDraftToBody(
  draft: ServiceDraft,
): { ok: true; body: ServiceInput } | { ok: false; error: string } {
  const validation = validateServiceDraft(draft);
  if (validation) return { ok: false, error: validation };
  const pricing = SERVICE_PRICING.find(([value]) => value === draft.pricingType);
  if (!pricing) return { ok: false, error: "Select a valid pricing type." };
  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category,
      pricingType: draft.pricingType,
      basePrice: Number(draft.basePrice),
      unit: pricing[2],
      estimatedDuration: draft.estimatedDuration.trim() ? Number(draft.estimatedDuration) : null,
      isActive: draft.isActive,
    },
  };
}