/**
 * Invoicing a range of finished work from the calendar.
 *
 * Spec V1 #26, §13.1. Hand-written rather than generated, like the other
 * calendar endpoints: this is one screen's conversation with one route, and
 * the OpenAPI surface is for the shapes other things consume.
 *
 * The same request answers both questions. `preview: true` returns the plan
 * and creates nothing; without it the server creates exactly that plan. One
 * planner on the server, so the review and the result cannot disagree.
 */
import { protectedFetch } from "@/lib/auth-scope";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface BulkInvoiceLine {
  jobId: number;
  description: string;
  amountCents: number;
}

export interface BulkInvoiceGroup {
  customerId: number;
  customerLabel: string;
  lines: BulkInvoiceLine[];
  totalCents: number;
  propertyId: number | null;
}

export interface SkippedBulkJob {
  id: number;
  label: string;
  /** invoiced · not_completed · cancelled · no_amount */
  reason: string;
  message: string;
}

export interface BulkInvoicePlan {
  from: string;
  to: string;
  groups: BulkInvoiceGroup[];
  skipped: SkippedBulkJob[];
  totals: { invoices: number; jobs: number; totalCents: number };
  summary: string;
  applied: boolean;
  /** Only on a run. */
  invoices?: Array<{
    invoiceId: number;
    invoiceNumber: string;
    customerId: number;
    customerLabel: string;
    jobIds: number[];
    totalCents: number;
  }>;
}

export async function bulkInvoice(body: {
  from: string;
  to: string;
  jobIds?: number[];
  preview?: boolean;
}): Promise<BulkInvoicePlan> {
  const response = await protectedFetch(`${BASE}/api/invoices/bulk`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((parsed as { error?: string })?.error ?? "The invoices could not be created");
  }
  return parsed as BulkInvoicePlan;
}

// The three things the screen works out for itself live in their own file:
// this one opens a connection on import, which a unit test cannot.
export { formatCents, monthRange, skipHeading } from "./bulk-invoice-format.ts";
