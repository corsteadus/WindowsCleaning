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
  scheduledStartTime: string;
  scheduledEndTime: string;
  crewId?: number | null;
  assignedUserIds?: string[];
  jobNotes?: string | null;
}

export interface LocationJobPlan extends LocationScheduleInput {
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  const byProperty = new Map<number, LocationScheduleInput>();
  for (const schedule of schedules) {
    if (!locationIds.has(schedule.propertyId)) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} is not in the accepted estimate`);
    }
    if (byProperty.has(schedule.propertyId)) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} is scheduled more than once`);
    }
    if (!isDateOnly(schedule.scheduledDate) || !isTimeOnly(schedule.scheduledStartTime) || !isTimeOnly(schedule.scheduledEndTime)) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} needs a valid date, start time, and end time`);
    }
    if (schedule.scheduledEndTime <= schedule.scheduledStartTime) {
      throw new EstimateConversionValidationError(`Location #${schedule.propertyId} must end after it starts`);
    }
    byProperty.set(schedule.propertyId, schedule);
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
    const startMinutes = Number(plan.scheduledStartTime.slice(0, 2)) * 60 + Number(plan.scheduledStartTime.slice(3));
    const endMinutes = Number(plan.scheduledEndTime.slice(0, 2)) * 60 + Number(plan.scheduledEndTime.slice(3));
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
      estimatedDuration: endMinutes - startMinutes,
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
