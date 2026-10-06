/**
 * What the calendar's job drawer shows.
 *
 * Phase 14, Step 3 — the other half. Clicking a card on the month should answer
 * the office's question without leaving the month: who, where, when, how much,
 * and is it invoiced.
 *
 * Two sources, on purpose. The card the person clicked is **already in memory**,
 * so the drawer opens with the answer rather than a spinner; the full job
 * arrives a moment later and fills in the phone number, the address and the
 * notes. Everything here is the merge of the two, kept pure so the precedence
 * is testable: **the detail wins where it has an answer, and only there.**
 */
import type { CalendarOccurrence } from "@/lib/calendar-api";
// Relative, not aliased: this is imported at runtime, and the unit tests run
// under node without the bundler that resolves `@/`.
import { formatTimeOfDay, formatTimeRange } from "./time-of-day.ts";

export interface JobDetailLike {
  id?: number;
  jobNumber?: string | null;
  status?: string | null;
  serviceType?: string | null;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  totalAmount?: number | string | null;
  notes?: string | null;
  customer?: {
    id?: number;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    cellPhone?: string | null;
    homePhone?: string | null;
    phone?: string | null;
  } | null;
  property?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  crew?: { id?: number; name?: string | null } | null;
  assignedTechnician?: { firstName?: string | null; lastName?: string | null } | null;
}

export interface JobDrawerSummary {
  jobId: number;
  jobNumber: string | null;
  status: string;
  invoiceStatus: string | null;
  customerName: string;
  customerId: number | null;
  customerPhone: string | null;
  serviceType: string | null;
  /** "Nov 10, 2026" — the date only; the time is its own line. */
  when: string;
  /** "9:00 AM – 11:00 AM", or "No time set". */
  time: string;
  where: string | null;
  who: string;
  amountCents: number | null;
  notes: string | null;
  /** True until the full job has arrived; the basics are already shown. */
  loadingDetail: boolean;
}

const personName = (first?: string | null, last?: string | null) =>
  [first, last].filter(Boolean).join(" ").trim();

function formatDateOnly(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "No date";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** The address as one line, with the parts that exist. */
export function addressLine(property: JobDetailLike["property"]): string | null {
  if (!property) return null;
  const street = (property.address ?? "").trim();
  const rest = [property.city, property.state, property.zip].filter(Boolean).join(", ").trim();
  const named = (property.name ?? "").trim();
  const lines = [named && named !== street ? named : null, street, rest].filter(Boolean);
  return lines.length ? lines.join(" · ") : null;
}

export function jobDrawerSummary(
  occurrence: CalendarOccurrence,
  detail?: JobDetailLike | null,
): JobDrawerSummary {
  const start = detail?.scheduledStartTime ?? occurrence.startTime;
  const end = detail?.scheduledEndTime ?? occurrence.endTime;
  const crewName = detail?.crew?.name ?? occurrence.crewName;
  const technician = personName(detail?.assignedTechnician?.firstName, detail?.assignedTechnician?.lastName);
  const customer = detail?.customer;
  const customerName = (customer?.companyName ?? "").trim()
    || personName(customer?.firstName, customer?.lastName)
    || occurrence.customerLabel;

  // The total only arrives with the detail; until then the card's cents stand.
  // A field technician is shown no money at all, and a null must stay null.
  const amountCents = occurrence.amountCents === null
    ? null
    : detail?.totalAmount === undefined || detail?.totalAmount === null
      ? occurrence.amountCents
      : Math.round(Number(detail.totalAmount) * 100);

  return {
    jobId: occurrence.id,
    jobNumber: detail?.jobNumber ?? occurrence.jobNumber ?? null,
    status: detail?.status ?? occurrence.status,
    invoiceStatus: occurrence.invoiceStatus,
    customerName,
    customerId: customer?.id ?? null,
    customerPhone: (customer?.cellPhone ?? customer?.phone ?? customer?.homePhone ?? null) || null,
    serviceType: detail?.serviceType ?? occurrence.serviceType,
    when: formatDateOnly(detail?.scheduledDate ?? occurrence.scheduledDate),
    time: formatTimeRange(start, end) || (formatTimeOfDay(start) || "No time set"),
    where: addressLine(detail?.property) ?? occurrence.propertyLabel ?? null,
    who: [crewName, technician].filter(Boolean).join(" · ") || "Nobody assigned yet",
    amountCents,
    notes: (detail?.notes ?? "").trim() || null,
    loadingDetail: !detail,
  };
}
