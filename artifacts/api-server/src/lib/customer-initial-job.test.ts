import assert from "node:assert/strict";
import test from "node:test";
import {
  assertActiveInitialJobReferences,
  duplicateOverrideActivity,
  initialJobIdempotencyResourceType,
  initialJobIdFromResourceType,
  initialJobSnapshot,
  normalizeInitialJob,
} from "./customer-initial-job.ts";

const valid = {
  accepted: true,
  scheduledDate: "2026-10-12",
  scheduledStartTime: "09:00",
  scheduledEndTime: "11:00",
  crewId: 2,
  employeeIds: ["u1", "u1"],
  serviceSnapshot: [{ serviceId: 3, serviceName: "Exterior", quantity: 2, unitPrice: 75, totalPrice: 150 }],
};

test("normalizes assignment and preserves an immutable service/location snapshot", () => {
  const input = normalizeInitialJob(valid);
  assert.deepEqual(input.employeeIds, ["u1"]);
  const snapshot = initialJobSnapshot(input, { id: 8, name: "Home", address: "1 Main", city: "St Joe", state: "MO", zip: "64501" });
  assert.equal(snapshot[0].totalPrice, 150);
  assert.equal(snapshot[0].locationSnapshot.address, "1 Main");
  assert.deepEqual(snapshot[0].assignedUserIds, ["u1"]);
});

test("rejects unaccepted, incomplete, and inconsistent schedules/snapshots", () => {
  assert.throws(() => normalizeInitialJob({ ...valid, accepted: false }), /explicitly accepted/);
  assert.throws(() => normalizeInitialJob({ ...valid, employeeIds: [] }), /active employee/);
  assert.throws(() => normalizeInitialJob({ ...valid, scheduledEndTime: "08:00" }), /after/);
  assert.throws(() => normalizeInitialJob({
    ...valid,
    serviceSnapshot: [{ ...valid.serviceSnapshot[0], totalPrice: 20 }],
  }), /totals/);
});

test("replay metadata binds the exact initial job rather than an arbitrary customer job", () => {
  assert.equal(initialJobIdFromResourceType(initialJobIdempotencyResourceType(42)), 42);
  assert.throws(() => initialJobIdFromResourceType("customer_initial_job"), /exact initial job identity/);
  assert.throws(() => initialJobIdFromResourceType("customer_initial_job:job:0"), /exact initial job identity/);
});

test("rejects inactive crew, employees, and catalog services at the transaction boundary", () => {
  const input = normalizeInitialJob(valid);
  const active = { crewActive: true, activeEmployeeIds: ["u1"], activeServices: [{ id: 3, name: "Exterior" }] };
  assert.doesNotThrow(() => assertActiveInitialJobReferences(input, active));
  assert.throws(() => assertActiveInitialJobReferences(input, { ...active, crewActive: false }), /crew is not active/);
  assert.throws(() => assertActiveInitialJobReferences(input, { ...active, activeEmployeeIds: [] }), /employee must be active/);
  assert.throws(() => assertActiveInitialJobReferences(input, { ...active, activeServices: [] }), /active catalog service/);
});

test("duplicate override audit preserves the server candidate evidence and reason", () => {
  const activity = duplicateOverrideActivity({ candidateCount: 2, matchTypes: ["email", "phone"], reason: "Separate legal entity" });
  assert.equal(activity.action, "customer_duplicate_override");
  assert.deepEqual(JSON.parse(activity.toValue), { candidateCount: 2, matchTypes: ["email", "phone"] });
  assert.match(activity.note, /Separate legal entity/);
});

test("transaction adapter rollback leaves no partial bundle and retry writes exactly one job", async () => {
  type State = { customers: number[]; contacts: number[]; properties: number[]; jobs: number[]; activities: string[]; outbox: number[] };
  let state: State = { customers: [], contacts: [], properties: [], jobs: [], activities: [], outbox: [] };
  const transaction = async (work: () => Promise<void>) => {
    const before = structuredClone(state);
    try {
      await work();
    } catch (error) {
      state = before;
      throw error;
    }
  };
  const writeBundle = async (failAfterJob: boolean) => transaction(async () => {
    state.customers.push(1);
    state.contacts.push(1);
    state.properties.push(1);
    state.jobs.push(42);
    if (failAfterJob) throw new Error("outbox unavailable");
    state.activities.push("customer_created", "job_created");
    state.outbox.push(42);
  });
  await assert.rejects(writeBundle(true), /outbox unavailable/);
  assert.deepEqual(state, { customers: [], contacts: [], properties: [], jobs: [], activities: [], outbox: [] });
  await writeBundle(false);
  assert.deepEqual(state.jobs, [42]);
  assert.deepEqual(state.outbox, [42]);
});