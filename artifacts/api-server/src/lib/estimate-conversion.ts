import { isDateOnly, isTimeOnly } from "./date.ts";
import { applyDiscounts, shareDiscount, type AppliedDiscount } from "./discounts.ts";
import { salesTax } from "./sales-tax.ts";

export interface AcceptedEstimateSnapshot {
  quote: {
    id: number;
    quoteNumber: string;
    customerId: number | null;
    leadId: number | null;
    totalAmount: number;
    notes: string | null;
    subtotal?: number;
    discountTotal?: number;
    taxTotal?: number;
  };
  /** Phase 6: the sales tax the estimate charges; null or absent, none. */
  tax?: { rate: number; label: string | null } | null;
  /** Phase 5. Absent on a revision finalized before discounts existed. */
  discounts?: AppliedDiscount[];
  lineItems: Array<{
    id: number;
    serviceId: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    propertyId: number | null;
    isUpsell: boolean;
    serviceNotes: string | null;
    /** Phase 6. Absent on a revision finalized before sales tax: not taxed. */
    taxable?: boolean;
  }>;
  locations: Array<{
    id: number;
    name: string | null;
    address: string;
    city: string;
    state: string;
    zip: string;
    notes: string | null;
  }>;
}

export interface LocationScheduleInput {
  propertyId: number;
  scheduledDate: string;
  /** Exact arrival, or where the arrival window opens. */
  scheduledStartTime: string;
  /** Older clients send the end; with `durationMinutes` it is worked out here instead. */
  scheduledEndTime?: string;
  /** A4: how long the work takes. The server works out the end from it. */
  durationMinutes?: number | null;
  /** A4: the customer is told "between start and start + this"; null or absent, an exact time. */
  arrivalWindowMinutes?: number | null;
  crewId?: number | null;
  assignedUserIds?: string[];
  jobNotes?: string | null;
}

export interface LocationJobPlan extends LocationScheduleInput {
  scheduledEndTime: string;
  durationMinutes: number;
  arrivalWindowMinutes: number | null;
  location: AcceptedEstimateSnapshot["locations"][number];
  lineItems: AcceptedEstimateSnapshot["lineItems"];
  /** Before discounts. */
  subtotal: number;
  /** This location's share of the estimate's discounts (phase 5). */
  discountTotal: number;
  /** After discounts: what the job is worth, before tax. */
  totalAmount: number;
  /** This location's share of the estimate's sales tax (phase 6). */
  taxTotal: number;
}

export class EstimateConversionValidationError extends Error {}

/** A4: the limits the office can choose within, the same on the screen and here. */
export const DURATION_MINUTES = { min: 15, max: 12 * 60, step: 5 } as const;
export const ARRIVAL_WINDOW_MINUTES = { min: 30, max: 8 * 60, step: 15 } as const;
const DAY_END = 24 * 60 - 1;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const inSteps = (value: unknown, limits: { min: number; max: number; step: number }): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= limits.min && value <= limits.max && value % limits.step === 0;

/**
 * When a location's job starts and ends, and the window the customer is told.
 * With a duration the end is the server's own sum, never the screen's; without
 * one (an older client) the end it sent must come after the start. Neither the
 * work nor the window may run past midnight.
 */
export function resolveScheduleTimes(schedule: LocationScheduleInput, place?: string | null): {
  scheduledStartTime: string; scheduledEndTime: string; durationMinutes: number; arrivalWindowMinutes: number | null;
} {
  const where = place?.trim() || `Location #${schedule.propertyId}`;
  if (!isDateOnly(schedule.scheduledDate) || !isTimeOnly(schedule.scheduledStartTime)) {
    throw new EstimateConversionValidationError(`${where} needs a valid date and start time`);
  }
  const start = minutesOf(schedule.scheduledStartTime);
  let duration: number;
  if (schedule.durationMinutes != null) {
    if (!inSteps(schedule.durationMinutes, DURATION_MINUTES)) {
      throw new EstimateConversionValidationError(`${where}: the job must take between 15 minutes and 12 hours, in 5-minute steps`);
    }
    duration = schedule.durationMinutes;
  } else {
    if (!isTimeOnly(schedule.scheduledEndTime)) throw new EstimateConversionValidationError(`${where} needs a valid end time or a duration`);
    duration = minutesOf(schedule.scheduledEndTime) - start;
    if (duration <= 0) throw new EstimateConversionValidationError(`${where} must end after it starts`);
  }
  if (start + duration > DAY_END) throw new EstimateConversionValidationError(`${where}: the work would run past midnight`);
  const window = schedule.arrivalWindowMinutes ?? null;
  if (window !== null) {
    if (!inSteps(window, ARRIVAL_WINDOW_MINUTES)) {
      throw new EstimateConversionValidationError(`${where}: an arrival window is between 30 minutes and 8 hours, in 15-minute steps`);
    }
    if (start + window > DAY_END) throw new EstimateConversionValidationError(`${where}: the arrival window would run past midnight`);
  }
  return { scheduledStartTime: timeOf(start), scheduledEndTime: timeOf(start + duration), durationMinutes: duration, arrivalWindowMinutes: window };
}

/**
 * A4 (Video 7): which of the estimate's services become work. The customer's
 * choice is the starting point; the office may untick one (not doing it now) or
 * tick a declined one back (they changed their mind by phone). Only services on
 * the estimate as offered can be chosen, and at least one must be. What differs
 * from the customer's choice is returned so the history can say so.
 */
export function conversionSelection(
  offered: AcceptedEstimateSnapshot,
  accepted: AcceptedEstimateSnapshot,
  lineItemIds: unknown,
): { snapshot: AcceptedEstimateSnapshot; added: number[]; removed: number[] } {
  const acceptedIds = accepted.lineItems.map((line) => line.id);
  let chosen: number[];
  if (lineItemIds === undefined || lineItemIds === null) {
    chosen = acceptedIds;
  } else {
    if (!Array.isArray(lineItemIds) || !lineItemIds.every((id) => Number.isInteger(id))) {
      throw new EstimateConversionValidationError("Choose the services by their ids");
    }
    chosen = [...new Set(lineItemIds as number[])];
    const unknown = chosen.find((id) => !offered.lineItems.some((line) => line.id === id));
    if (unknown !== undefined) throw new EstimateConversionValidationError(`Service #${unknown} is not on this estimate`);
  }
  if (!chosen.length) throw new EstimateConversionValidationError("Tick at least one service to schedule");
  // The customer's copy of a line when they took it; the offered one otherwise.
  const lineItems = offered.lineItems
    .filter((line) => chosen.includes(line.id))
    .map((line) => accepted.lineItems.find((taken) => taken.id === line.id) ?? line);
  const single = offered.locations.length === 1;
  const locations = offered.locations.filter((location) =>
    lineItems.some((line) => line.propertyId === location.id || (single && line.propertyId === null)));
  return {
    snapshot: { ...accepted, lineItems, locations },
    added: chosen.filter((id) => !acceptedIds.includes(id)).sort((a, b) => a - b),
    removed: acceptedIds.filter((id) => !chosen.includes(id)).sort((a, b) => a - b),
  };
}

export function buildLocationJobPlans(
  snapshot: AcceptedEstimateSnapshot,
  schedules: LocationScheduleInput[],
): LocationJobPlan[] {
  if (!snapshot.locations.length) {
    throw new EstimateConversionValidationError("The accepted estimate has no physical locations");
  }
  if (!snapshot.lineItems.length) {
    throw new EstimateConversionValidationError("The accepted estimate has no services");
  }
  const locationIds = new Set(snapshot.locations.map((location) => location.id));
  const byProperty = new Map<number, LocationScheduleInput & ReturnType<typeof resolveScheduleTimes>>();
  for (const schedule of schedules) {
    if (!locationIds.has(schedule.propertyId)) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} has no services being scheduled`);
    }
    if (byProperty.has(schedule.propertyId)) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} is scheduled more than once`);
    }
    const location = snapshot.locations.find((l) => l.id === schedule.propertyId)!;
    byProperty.set(schedule.propertyId, { ...schedule, ...resolveScheduleTimes(schedule, location.name || location.address) });
  }
  if (byProperty.size !== locationIds.size) {
    throw new EstimateConversionValidationError("Every accepted estimate location must have a complete schedule");
  }

  const unassigned = snapshot.lineItems.filter((line) => line.propertyId === null);
  if (snapshot.locations.length > 1 && unassigned.length) {
    throw new EstimateConversionValidationError("Every service on a multi-location estimate must be assigned to a location");
  }

  const grouped = snapshot.locations.map((location) => {
    const lineItems = snapshot.lineItems.filter((line) =>
      line.propertyId === location.id || (snapshot.locations.length === 1 && line.propertyId === null),
    );
    if (!lineItems.length) {
      throw new EstimateConversionValidationError(`Location #${location.id} has no accepted services`);
    }
    return { location, lineItems, subtotal: centsSum(lineItems.map((line) => Number(line.totalPrice))) };
  });
  // Phase 5: the estimate's discounts, worked out on what is being converted,
  // shared between the locations' jobs in proportion to each one's work.
  const discount = applyDiscounts(centsSum(grouped.map((group) => group.subtotal)), snapshot.discounts ?? []).discountTotal;
  const shares = shareDiscount(discount, grouped.map((group) => group.subtotal));
  // Phase 6: the estimate's tax on what is converted, shared by each location's taxable work.
  const tax = salesTax(snapshot.lineItems.filter((line) => grouped.some((g) => g.lineItems.includes(line)))
    .map((line) => ({ totalPrice: Number(line.totalPrice), taxable: Boolean(line.taxable) })), discount, snapshot.tax?.rate ?? null).tax;
  const taxShares = shareDiscount(tax, grouped.map((group) =>
    centsSum(group.lineItems.filter((line) => line.taxable).map((line) => Number(line.totalPrice)))));
  return grouped.map(({ location, lineItems, subtotal }, i) => {
    const schedule = byProperty.get(location.id)!;
    return {
      ...schedule,
      assignedUserIds: [...new Set(schedule.assignedUserIds ?? [])],
      location,
      lineItems,
      subtotal,
      discountTotal: shares[i],
      totalAmount: (Math.round(subtotal * 100) - Math.round(shares[i] * 100)) / 100,
      taxTotal: taxShares[i],
    };
  });
}

export function isAcceptedEstimate(status: string, hasAcceptedDecision: boolean): boolean {
  // Three ways an estimate is accepted, and all three are evidenced:
  //   - the customer's own decision on the secure link (the strongest),
  //   - "approved", retained only for imported and legacy converted quotes,
  //   - "accepted" written by Correct Status, which since 2026-10-10 (Kyle's
  //     #23) an authorised employee may set and which the route refuses
  //     without a written reason.
  // The third is what makes an over-the-phone acceptance schedulable at all.
  return status === "approved" || status === "accepted" || hasAcceptedDecision;
}

export interface AcceptedEstimateJobAdapter<TJob> {
  findJobsByQuoteId(quoteId: number): Promise<TJob[]>;
  /** Must lock all active assignment rows in the insert transaction. */
  validateAndLockActiveAssignments?(plans: LocationJobPlan[]): Promise<void>;
  insertJob(values: Record<string, unknown>): Promise<TJob>;
  recordScheduledEvent(job: TJob, plan: LocationJobPlan): Promise<void>;
}

export async function persistAcceptedEstimateJobsCore<TJob extends { id: number }>(
  input: {
    quoteId: number;
    customerId: number;
    revisionId: number;
    quoteNumber: string;
    snapshot: AcceptedEstimateSnapshot;
    plans: LocationJobPlan[];
  },
  adapter: AcceptedEstimateJobAdapter<TJob>,
): Promise<{ kind: "created" | "existing"; jobs: TJob[] }> {
  const existing = await adapter.findJobsByQuoteId(input.quoteId);
  if (existing.length) return { kind: "existing", jobs: existing };
  await adapter.validateAndLockActiveAssignments?.(input.plans);
  const jobs: TJob[] = [];
  for (const [index, plan] of input.plans.entries()) {
    const lineItems = plan.lineItems.map((line) => ({
      ...line,
      acceptedRevisionId: input.revisionId,
      assignedUserIds: plan.assignedUserIds ?? [],
    }));
    const job = await adapter.insertJob({
      customerId: input.customerId,
      propertyId: plan.propertyId,
      quoteId: input.quoteId,
      crewId: plan.crewId ?? null,
      jobNumber: `J-${input.quoteNumber}-${index + 1}`,
      status: "scheduled",
      serviceType: plan.lineItems.map((line) => line.description).join(", "),
      scheduledDate: plan.scheduledDate,
      scheduledStartTime: plan.scheduledStartTime,
      scheduledEndTime: plan.scheduledEndTime,
      estimatedDuration: plan.durationMinutes,
      arrivalWindowMinutes: plan.arrivalWindowMinutes,
      isRecurring: false,
      totalAmount: String(plan.totalAmount),
      discountTotal: String(plan.discountTotal),
      taxTotal: String(plan.taxTotal),
      notes: [input.snapshot.quote.notes, plan.location.notes, plan.jobNotes].filter(Boolean).join("\n\n") || null,
      lineItems: JSON.stringify(lineItems),
    });
    jobs.push(job);
    await adapter.recordScheduledEvent(job, plan);
  }
  return { kind: "created", jobs };
}
const centsSum = (values: readonly number[]) => values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;

/**
 * A4: "Schedule + create invoice" — the invoice's lines, one per service, for
 * the jobs just made. Each job's discount is shared between its services and
 * its tax between its taxable ones, to the cent, so the invoice comes to exactly
 * what the jobs are worth. A service whose quantity × price is not its amount to
 * the cent is billed as one of its amount, so nothing is rounded twice.
 */
export function conversionInvoiceLines(plans: readonly LocationJobPlan[], jobIds: readonly number[]) {
  return plans.flatMap((plan, i) => {
    const amounts = plan.lineItems.map((line) => Number(line.totalPrice));
    const discounts = shareDiscount(plan.discountTotal, amounts);
    const taxes = shareDiscount(plan.taxTotal, plan.lineItems.map((line, k) =>
      line.taxable ? (Math.round(amounts[k] * 100) - Math.round(discounts[k] * 100)) / 100 : 0));
    return plan.lineItems.map((line, k) => {
      const exact = Math.round(Number(line.quantity) * Number(line.unitPrice) * 100) === Math.round(amounts[k] * 100);
      return {
        jobId: jobIds[i],
        description: line.description,
        quantity: exact ? String(line.quantity) : "1",
        unitPrice: exact ? Number(line.unitPrice).toFixed(2) : amounts[k].toFixed(2),
        discountAmount: discounts[k].toFixed(2),
        taxAmount: taxes[k].toFixed(2),
      };
    });
  });
}
