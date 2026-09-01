import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocationJobPlans, EstimateConversionValidationError, isAcceptedEstimate, persistAcceptedEstimateJobsCore,
  type AcceptedEstimateSnapshot,
} from "./estimate-conversion.ts";

const snapshot: AcceptedEstimateSnapshot = {
  quote: { id: 4, quoteNumber: "Q-4", customerId: 8, leadId: null, totalAmount: 150, notes: "Estimate note" },
  locations: [
    { id: 10, name: "Home", address: "1 A St", city: "Austin", state: "TX", zip: "78701", notes: null },
    { id: 11, name: "Shop", address: "2 B St", city: "Austin", state: "TX", zip: "78702", notes: null },
  ],
  lineItems: [
    { id: 1, serviceId: 3, description: "Exterior", quantity: 1, unitPrice: 100, totalPrice: 100, propertyId: 10, isUpsell: false, serviceNotes: null },
    { id: 2, serviceId: 4, description: "Interior", quantity: 1, unitPrice: 50, totalPrice: 50, propertyId: 11, isUpsell: true, serviceNotes: "Approved upsell" },
  ],
};

test("buildLocationJobPlans creates exactly one immutable plan per location", () => {
  const plans = buildLocationJobPlans(snapshot, [
    { propertyId: 10, scheduledDate: "2026-09-01", scheduledStartTime: "09:00", scheduledEndTime: "10:00", crewId: 2 },
    { propertyId: 11, scheduledDate: "2026-09-02", scheduledStartTime: "13:00", scheduledEndTime: "14:30", assignedUserIds: ["u1", "u1"] },
  ]);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].totalAmount, 100);
  assert.deepEqual(plans[1].assignedUserIds, ["u1"]);
  assert.equal(plans[1].lineItems[0].unitPrice, 50);
});

test("buildLocationJobPlans rejects partial schedules and unassigned multi-location services", () => {
  assert.throws(() => buildLocationJobPlans(snapshot, [
    { propertyId: 10, scheduledDate: "2026-09-01", scheduledStartTime: "09:00", scheduledEndTime: "10:00" },
  ]), EstimateConversionValidationError);
  assert.throws(() => buildLocationJobPlans({
    ...snapshot, lineItems: [{ ...snapshot.lineItems[0], propertyId: null }],
  }, [
    { propertyId: 10, scheduledDate: "2026-09-01", scheduledStartTime: "09:00", scheduledEndTime: "10:00" },
    { propertyId: 11, scheduledDate: "2026-09-02", scheduledStartTime: "09:00", scheduledEndTime: "10:00" },
  ]), /assigned to a location/);
});

test("accepted and legacy approved statuses are terminal acceptance", () => {
  assert.equal(isAcceptedEstimate("accepted", false), false);
  assert.equal(isAcceptedEstimate("approved", false), true);
  assert.equal(isAcceptedEstimate("sent", true), true);
  assert.equal(isAcceptedEstimate("sent", false), false);
});

test("accepted-estimate conversion persists actual appointment data as scheduled", async () => {
  const plans = buildLocationJobPlans(snapshot, [
    { propertyId: 10, scheduledDate: "2026-09-01", scheduledStartTime: "09:00", scheduledEndTime: "10:00" },
    { propertyId: 11, scheduledDate: "2026-09-02", scheduledStartTime: "13:00", scheduledEndTime: "14:30" },
  ]);
  const inserted: Array<Record<string, unknown> & { id: number }> = [];
  const result = await persistAcceptedEstimateJobsCore({
    quoteId: 4, customerId: 8, revisionId: 9, quoteNumber: "Q-4", snapshot, plans,
  }, {
    findJobsByQuoteId: async () => [],
    insertJob: async (values) => {
      const job = { ...values, id: inserted.length + 1 };
      inserted.push(job);
      return job;
    },
    recordScheduledEvent: async () => {},
  });
  assert.equal(result.kind, "created");
  assert.equal(inserted[0].status, "scheduled");
  assert.equal(inserted[0].scheduledDate, "2026-09-01");
  assert.equal(inserted[0].scheduledStartTime, "09:00");
  assert.equal(inserted[0].scheduledEndTime, "10:00");
});

test("estimate conversion validates and locks assignments before its first insert", async () => {
  const plans = buildLocationJobPlans(snapshot, [
    { propertyId: 10, scheduledDate: "2026-09-01", scheduledStartTime: "09:00", scheduledEndTime: "10:00" },
    { propertyId: 11, scheduledDate: "2026-09-02", scheduledStartTime: "13:00", scheduledEndTime: "14:30" },
  ]);
  const order: string[] = [];
  await assert.rejects(() => persistAcceptedEstimateJobsCore({
    quoteId: 4, customerId: 8, revisionId: 9, quoteNumber: "Q-4", snapshot, plans,
  }, {
    findJobsByQuoteId: async () => [],
    validateAndLockActiveAssignments: async () => {
      order.push("validate-lock");
      throw new EstimateConversionValidationError("inactive assignment");
    },
    insertJob: async () => {
      order.push("insert");
      return { id: 1 };
    },
    recordScheduledEvent: async () => {},
  }), /inactive assignment/);
  assert.deepEqual(order, ["validate-lock"]);
});