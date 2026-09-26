import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { acceptedSnapshotFor, EstimateAcceptanceError } from "./estimate-acceptance.ts";
import type { AcceptedEstimateSnapshot } from "./estimate-conversion.ts";

const line = (id: number, price: number, propertyId: number | null = 1) => ({
  id, serviceId: id, description: `Service ${id}`, quantity: 1,
  unitPrice: price, totalPrice: price, propertyId, isUpsell: false, serviceNotes: null,
});
const location = (id: number) => ({
  id, name: null, address: `${id} Evergreen Terrace`, city: "St. Joseph", state: "MO", zip: "64501", notes: null,
});
const snapshotOf = (
  lineItems: AcceptedEstimateSnapshot["lineItems"],
  locations: AcceptedEstimateSnapshot["locations"],
): AcceptedEstimateSnapshot => ({
  quote: {
    id: 7, quoteNumber: "Q-7", customerId: 3, leadId: null,
    totalAmount: lineItems.reduce((sum, item) => sum + item.totalPrice, 0), notes: null,
  },
  lineItems,
  locations,
});

describe("acceptedSnapshotFor", () => {
  it("takes the whole estimate when no choice is sent", () => {
    const snapshot = snapshotOf([line(1, 300), line(2, 150)], [location(1)]);
    const result = acceptedSnapshotFor(snapshot, null);
    assert.equal(result.whole, true);
    assert.deepEqual(result.acceptedLineItemIds, [1, 2]);
    assert.deepEqual(result.declinedLineItemIds, []);
    assert.equal(result.acceptedTotal, 450);
  });

  it("keeps only the services the customer ticked, and re-totals the estimate", () => {
    const snapshot = snapshotOf([line(1, 300), line(2, 150)], [location(1)]);
    const result = acceptedSnapshotFor(snapshot, [1]);
    assert.equal(result.whole, false);
    assert.deepEqual(result.snapshot.lineItems.map((item) => item.id), [1]);
    assert.deepEqual(result.declinedLineItemIds, [2]);
    assert.equal(result.acceptedTotal, 300);
    assert.equal(result.snapshot.quote.totalAmount, 300, "the job is billed for what was accepted");
  });

  it("drops a location once every one of its services is declined", () => {
    const snapshot = snapshotOf(
      [line(1, 300, 1), line(2, 150, 2)],
      [location(1), location(2)],
    );
    const result = acceptedSnapshotFor(snapshot, [1]);
    assert.deepEqual(result.snapshot.locations.map((l) => l.id), [1],
      "a location with nothing left to do would stop the conversion");
  });

  it("keeps both locations when a service at each is accepted", () => {
    const snapshot = snapshotOf(
      [line(1, 300, 1), line(2, 150, 2), line(3, 90, 2)],
      [location(1), location(2)],
    );
    const result = acceptedSnapshotFor(snapshot, [1, 3]);
    assert.deepEqual(result.snapshot.locations.map((l) => l.id), [1, 2]);
    assert.equal(result.acceptedTotal, 390);
  });

  it("keeps the only location for a service that names none", () => {
    const snapshot = snapshotOf([line(1, 300, null), line(2, 150, null)], [location(1)]);
    const result = acceptedSnapshotFor(snapshot, [2]);
    assert.deepEqual(result.snapshot.locations.map((l) => l.id), [1]);
    assert.equal(result.acceptedTotal, 150);
  });

  it("ignores a service ticked twice", () => {
    const snapshot = snapshotOf([line(1, 300), line(2, 150)], [location(1)]);
    const result = acceptedSnapshotFor(snapshot, [1, 1, 1]);
    assert.deepEqual(result.acceptedLineItemIds, [1]);
    assert.equal(result.acceptedTotal, 300);
  });

  it("preserves the order the estimate was written in, not the order ticked", () => {
    const snapshot = snapshotOf([line(1, 300), line(2, 150), line(3, 90)], [location(1)]);
    const result = acceptedSnapshotFor(snapshot, [3, 1]);
    assert.deepEqual(result.acceptedLineItemIds, [1, 3]);
  });

  it("refuses an empty choice rather than accepting nothing", () => {
    const snapshot = snapshotOf([line(1, 300)], [location(1)]);
    assert.throws(() => acceptedSnapshotFor(snapshot, []), EstimateAcceptanceError);
  });

  it("refuses a service that is not on the estimate, and names it", () => {
    const snapshot = snapshotOf([line(1, 300)], [location(1)]);
    assert.throws(() => acceptedSnapshotFor(snapshot, [1, 99]), /Service #99 is not on this estimate/);
  });

  it("refuses an id that is not a whole number", () => {
    const snapshot = snapshotOf([line(1, 300)], [location(1)]);
    assert.throws(() => acceptedSnapshotFor(snapshot, [1.5]), EstimateAcceptanceError);
  });

  it("refuses something that is not a list", () => {
    const snapshot = snapshotOf([line(1, 300)], [location(1)]);
    assert.throws(() => acceptedSnapshotFor(snapshot, "1" as unknown as number[]), EstimateAcceptanceError);
  });

  it("refuses an estimate with no services at all", () => {
    assert.throws(() => acceptedSnapshotFor(snapshotOf([], [location(1)]), null), EstimateAcceptanceError);
  });

  it("adds fractional prices without leaving a rounding tail", () => {
    const snapshot = snapshotOf([line(1, 10.1), line(2, 20.2)], [location(1)]);
    assert.equal(acceptedSnapshotFor(snapshot, [1, 2]).acceptedTotal, 30.3);
  });

  it("leaves the original snapshot untouched", () => {
    const snapshot = snapshotOf([line(1, 300), line(2, 150)], [location(1)]);
    acceptedSnapshotFor(snapshot, [1]);
    assert.equal(snapshot.lineItems.length, 2);
    assert.equal(snapshot.quote.totalAmount, 450);
  });
});
