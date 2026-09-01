import { hasClientCapability, type CapabilityEnvelope } from "./rbac.ts";

export interface JobFinancialVisibility {
  showJobValue: boolean;
  showInvoices: boolean;
  showLinkedQuote: boolean;
}

/** Derives financial UI exclusively from the server's canonical capability envelope. */
export function getJobFinancialVisibility(
  envelope: CapabilityEnvelope | null | undefined,
): JobFinancialVisibility {
  return {
    showJobValue: hasClientCapability(envelope, "invoices.view"),
    showInvoices: hasClientCapability(envelope, "invoices.view"),
    showLinkedQuote: hasClientCapability(envelope, "quotes.view"),
  };
}