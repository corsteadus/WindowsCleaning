import type { ServiceInput } from "@workspace/api-client-react";

/**
 * What the Service Catalog asks for.
 *
 * Kyle (Testing Edits, 2026-10-01, #8): *"Keep Service Name / Title and Category
 * as the core catalog information. Do not require or store a default price when
 * a service is created in the Service Catalog … The actual price should be
 * entered when the service is used on a specific quote or job."*
 *
 * So there is no price, pricing type or unit here at all. Categories are the
 * business's own list, fetched like any other dropdown, which is why this is a
 * plain string rather than a fixed set.
 */

export type ServiceDraft = {
  name: string;
  description: string;
  category: string;
  estimatedDuration: string;
  isActive: boolean;
};

export const emptyServiceDraft = (category = ""): ServiceDraft => ({
  name: "", description: "", category, estimatedDuration: "", isActive: true,
});

export function validateServiceDraft(draft: ServiceDraft): string | null {
  if (!draft.name.trim()) return "Service name is required.";
  if (!draft.category.trim()) return "Choose a category.";
  if (draft.estimatedDuration.trim()) {
    const duration = Number(draft.estimatedDuration);
    if (!Number.isInteger(duration) || duration < 0) return "Duration must be a nonnegative whole number of minutes.";
  }
  return null;
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
  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category.trim(),
      // No price is set here. It is entered on the quote or job that uses it.
      pricingType: null,
      basePrice: null,
      unit: null,
      estimatedDuration: draft.estimatedDuration.trim() ? Number(draft.estimatedDuration) : null,
      isActive: draft.isActive,
    },
  };
}
