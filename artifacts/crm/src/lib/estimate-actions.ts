/**
 * Finalizing an estimate from somewhere other than its own page — the Add
 * Prospect form's "Save and email" and the profile's "Convert to Customer".
 * Each line goes back with its own location and customer-visible description
 * (#31) and, when still to be quoted, a null price; Finalize replaces the
 * lines, so anything left out would be lost (see estimates.ts on the server).
 */
import { protectedFetch } from "./auth-scope.ts";

const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/+$/, "");

export async function estimateCall<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    credentials: "include", headers: { "Content-Type": "application/json" }, ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

export interface QuoteForFinalize {
  notes?: string | null;
  terms?: string | null;
  propertyId?: number | null;
  lineItems?: Array<{
    serviceId?: number | null; description: string; quantity: number;
    unitPrice: number | null; serviceNotes?: string | null; propertyId?: number | null;
  }>;
}

/** The body Finalize needs, from the quote as the server reads it back. */
export function finalizeBody(quote: QuoteForFinalize) {
  return {
    notes: quote.notes ?? null,
    terms: quote.terms ?? null,
    lineItems: (quote.lineItems ?? []).map((line) => ({
      serviceId: line.serviceId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      serviceNotes: line.serviceNotes ?? null,
      propertyId: line.propertyId ?? quote.propertyId ?? null,
    })),
  };
}

export async function finalizeEstimate(quoteId: number): Promise<void> {
  const quote = await estimateCall<QuoteForFinalize>(`/quotes/${quoteId}`);
  await estimateCall(`/quotes/${quoteId}/finalize`, { method: "POST", body: JSON.stringify(finalizeBody(quote)) });
}
