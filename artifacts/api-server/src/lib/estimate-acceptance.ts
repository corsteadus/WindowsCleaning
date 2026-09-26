/**
 * Partial acceptance of an estimate.
 *
 * Kyle, 2026-09-24: *"The customer does not have to accept the entire estimate.
 * Acceptance should work at the individual service-line-item level … When the
 * office later creates the job, the job should be based on the line items the
 * customer actually accepted."*
 *
 * So acceptance narrows the snapshot rather than flagging it. Everything
 * downstream — the conversion preview, `buildLocationJobPlans`, the job's total
 * — already reads the accepted snapshot and needs no knowledge of the choice.
 *
 * A location that loses every one of its services is dropped with them, because
 * `buildLocationJobPlans` refuses a location with nothing to do.
 */
import type { AcceptedEstimateSnapshot } from "./estimate-conversion.ts";

export class EstimateAcceptanceError extends Error {}

export interface AcceptanceOutcome {
  /** The snapshot the office converts from: only what the customer ticked. */
  snapshot: AcceptedEstimateSnapshot;
  acceptedLineItemIds: number[];
  declinedLineItemIds: number[];
  /** True when the customer took everything offered — the old whole-estimate accept. */
  whole: boolean;
  acceptedTotal: number;
}

/**
 * `ids` absent or null means the whole estimate, which is what every estimate
 * accepted before this existed meant, and what the "Accept everything" button
 * still sends.
 */
export function acceptedSnapshotFor(
  snapshot: AcceptedEstimateSnapshot,
  ids: readonly number[] | null | undefined,
): AcceptanceOutcome {
  const all = snapshot.lineItems ?? [];
  if (!all.length) throw new EstimateAcceptanceError("This estimate has no services to accept");

  if (ids === null || ids === undefined) return outcome(snapshot, all.map((line) => line.id), all);

  if (!Array.isArray(ids)) throw new EstimateAcceptanceError("acceptedLineItemIds must be a list of service ids");
  const chosen = [...new Set(ids.map((id) => Number(id)))];
  if (chosen.some((id) => !Number.isInteger(id))) {
    throw new EstimateAcceptanceError("Every accepted service id must be a whole number");
  }
  if (!chosen.length) throw new EstimateAcceptanceError("Choose at least one service to accept");

  const offered = new Set(all.map((line) => line.id));
  const stranger = chosen.find((id) => !offered.has(id));
  if (stranger !== undefined) {
    throw new EstimateAcceptanceError(`Service #${stranger} is not on this estimate`);
  }
  return outcome(snapshot, chosen, all);
}

function outcome(
  snapshot: AcceptedEstimateSnapshot,
  chosen: number[],
  all: AcceptedEstimateSnapshot["lineItems"],
): AcceptanceOutcome {
  const keep = new Set(chosen);
  const lineItems = all.filter((line) => keep.has(line.id));
  const acceptedTotal = round2(lineItems.reduce((sum, line) => sum + Number(line.totalPrice), 0));

  // A line that names no location belongs to the only location there is; that is
  // the rule buildLocationJobPlans works by, so location trimming follows it.
  const named = new Set(lineItems.map((line) => line.propertyId).filter((id): id is number => id !== null));
  const unassigned = lineItems.some((line) => line.propertyId === null);
  const locations = (snapshot.locations ?? []).filter((location) =>
    named.has(location.id) || (unassigned && (snapshot.locations ?? []).length === 1),
  );

  return {
    snapshot: {
      ...snapshot,
      quote: { ...snapshot.quote, totalAmount: acceptedTotal },
      lineItems,
      locations,
    },
    acceptedLineItemIds: lineItems.map((line) => line.id),
    declinedLineItemIds: all.filter((line) => !keep.has(line.id)).map((line) => line.id),
    whole: lineItems.length === all.length,
    acceptedTotal,
  };
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
