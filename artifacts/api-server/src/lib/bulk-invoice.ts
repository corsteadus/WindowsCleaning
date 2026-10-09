/**
 * Invoicing a range of finished work in one go.
 *
 * Spec V1 #26 and §13.1, and the fifth of the five prototype tests (§18). The
 * office finishes a week and bills it; doing that one job at a time is where
 * the evening goes.
 *
 * The shape is Move Entire Day's, for the same reasons:
 *
 * 1. **It shows what it would do before it does it.** The same planner answers
 *    the preview and the run, so the review screen cannot promise one thing
 *    and the button do another.
 * 2. **It leaves nothing out silently.** Every job in the range that will not
 *    be invoiced is named with the reason.
 * 3. **It cannot bill the same work twice.** A job already on an invoice is
 *    excluded here, because the database does not stop it: `invoice_jobs` is
 *    unique on (invoice, job), not on job, and deliberately so — a reissue
 *    links the same job to its replacement invoice.
 *
 * **One invoice per customer, one line per job.** Three visits in a month is
 * one bill, which is how the office posts it and how the customer expects to
 * read it. Each line still names its job, so an invoice can always be taken
 * back apart.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface BillableJob {
  id: number;
  customerId: number;
  /** For the review screen and for the line that will carry it. */
  customerLabel: string;
  jobNumber: string;
  scheduledDate: string | null;
  status: string;
  serviceType: string | null;
  /** The job's total as the database holds it: a decimal string. */
  totalAmount: string;
  /** Already on an invoice. */
  hasInvoice: boolean;
  propertyId: number | null;
}

/** Why a job in the range is not being invoiced. */
export type BulkSkipReason = "invoiced" | "not_completed" | "cancelled" | "no_amount";

export interface SkippedBulkJob {
  id: number;
  label: string;
  reason: BulkSkipReason;
  message: string;
}

export interface BulkInvoiceLine {
  jobId: number;
  description: string;
  /** Integer cents, so the review screen and the invoice cannot disagree. */
  amountCents: number;
}

export interface BulkInvoiceGroup {
  customerId: number;
  customerLabel: string;
  lines: BulkInvoiceLine[];
  totalCents: number;
  /** Set only when every job shares one property; an invoice has room for one. */
  propertyId: number | null;
}

export interface BulkInvoicePlan {
  from: string;
  to: string;
  groups: BulkInvoiceGroup[];
  skipped: SkippedBulkJob[];
  /** What the office is about to create, before it creates it. */
  totals: { invoices: number; jobs: number; totalCents: number };
}

export type BulkInvoiceResult =
  | { ok: false; status: number; error: string }
  | { ok: true; plan: BulkInvoicePlan };

/** A decimal string as integer cents. Anything unreadable counts as nothing. */
export function amountCents(value: string | null | undefined): number {
  const raw = (value ?? "").trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return 0;
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Cents back to the decimal string the invoice tables hold. */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** A date-only value as the platform writes it: 2026-10-01 is Oct 1, 2026. */
function readableDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/**
 * What each line will say: the job, what it was, and when it was done.
 *
 * This is the text the customer reads on the bill, so it is written the way
 * every other screen writes a date — and it is written here rather than on the
 * review screen, so the review and the invoice cannot say different things.
 */
export function lineDescription(job: BillableJob): string {
  const parts = [job.serviceType?.trim() || "Service", job.jobNumber];
  if (job.scheduledDate) parts.push(readableDate(job.scheduledDate));
  return parts.join(" · ");
}

function skipFor(job: BillableJob): SkippedBulkJob | null {
  const label = `${job.customerLabel} · ${job.jobNumber}`;
  const status = job.status.trim().toLowerCase();
  if (job.hasInvoice) {
    return { id: job.id, label, reason: "invoiced", message: "Already on an invoice" };
  }
  if (status === "canceled" || status === "cancelled") {
    return { id: job.id, label, reason: "cancelled", message: "Cancelled work is not invoiced" };
  }
  if (status !== "completed") {
    // §13.1 asks for a warning about work that is not marked complete. It is
    // named rather than billed: an invoice for work the crew has not finished
    // is a phone call, and marking the job complete is one click away.
    return { id: job.id, label, reason: "not_completed", message: `Not marked complete (${job.status})` };
  }
  if (amountCents(job.totalAmount) <= 0) {
    return { id: job.id, label, reason: "no_amount", message: "No amount on the job" };
  }
  return null;
}

/**
 * What invoicing this range would produce.
 *
 * `selected` narrows it to particular jobs — the review screen's checkboxes —
 * and an id that is not in the range is simply not in the plan.
 */
export function planBulkInvoices(input: {
  from: unknown;
  to: unknown;
  jobs: ReadonlyArray<BillableJob>;
  selected?: ReadonlyArray<number> | null;
}): BulkInvoiceResult {
  const from = typeof input.from === "string" ? input.from.trim() : "";
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
    return { ok: false, status: 400, error: "from and to must both be YYYY-MM-DD dates" };
  }
  if (to < from) {
    return { ok: false, status: 400, error: "The range ends before it starts" };
  }

  const chosen = input.selected && input.selected.length > 0
    ? new Set(input.selected.map(Number))
    : null;
  const considered = chosen
    ? input.jobs.filter((job) => chosen.has(job.id))
    : input.jobs;

  const skipped: SkippedBulkJob[] = [];
  const byCustomer = new Map<number, BulkInvoiceGroup>();
  // Grouped in the order the jobs arrive, so the review screen reads in the
  // order the calendar does.
  for (const job of considered) {
    const skip = skipFor(job);
    if (skip) {
      skipped.push(skip);
      continue;
    }
    const cents = amountCents(job.totalAmount);
    let group = byCustomer.get(job.customerId);
    if (!group) {
      group = {
        customerId: job.customerId,
        customerLabel: job.customerLabel,
        lines: [],
        totalCents: 0,
        propertyId: job.propertyId,
      };
      byCustomer.set(job.customerId, group);
    } else if (group.propertyId !== job.propertyId) {
      // Two properties on one invoice: the invoice carries none, and each line
      // still names its own job.
      group.propertyId = null;
    }
    group.lines.push({ jobId: job.id, description: lineDescription(job), amountCents: cents });
    group.totalCents += cents;
  }

  const groups = [...byCustomer.values()];
  return {
    ok: true,
    plan: {
      from,
      to,
      groups,
      skipped,
      totals: {
        invoices: groups.length,
        jobs: groups.reduce((count, group) => count + group.lines.length, 0),
        totalCents: groups.reduce((sum, group) => sum + group.totalCents, 0),
      },
    },
  };
}

/** What the office is told afterwards, in one sentence. */
export function describeBulkInvoices(plan: BulkInvoicePlan): string {
  const { invoices, jobs } = plan.totals;
  if (invoices === 0) {
    return plan.skipped.length === 0
      ? `Nothing to invoice between ${plan.from} and ${plan.to}`
      : `Nothing invoiced: all ${plan.skipped.length} jobs were skipped`;
  }
  const made = `${invoices} ${invoices === 1 ? "invoice" : "invoices"}`
    + ` for ${jobs} ${jobs === 1 ? "job" : "jobs"}`;
  const left = plan.skipped.length
    ? `, ${plan.skipped.length} ${plan.skipped.length === 1 ? "job" : "jobs"} skipped`
    : "";
  return made + left;
}
