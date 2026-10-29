// A4 (Kyle, Video 7): choose the services, an arrival window and a duration, and the invoice with the jobs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildLocationJobPlans, conversionInvoiceLines, conversionSelection, EstimateConversionValidationError, resolveScheduleTimes,
  type AcceptedEstimateSnapshot,
} from "./estimate-conversion.ts";
import { calculateInvoiceLines } from "./invoice-core.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const loc = (id: number) => ({ id, name: null, address: `${id} Oak`, city: "KC", state: "MO", zip: "64111", notes: null });
const line = (id: number, propertyId: number, totalPrice: number, extra: Record<string, unknown> = {}) => ({
  id, serviceId: null, description: `Service ${id}`, quantity: 1, unitPrice: totalPrice, totalPrice, propertyId, isUpsell: false, serviceNotes: null, ...extra,
});
const offered: AcceptedEstimateSnapshot = {
  quote: { id: 1, quoteNumber: "Q-1", customerId: 9, leadId: null, totalAmount: 0, notes: null },
  discounts: [{ name: "Spring", kind: "percent", value: 10, amount: 0 }],
  tax: { rate: 8.25, label: "KC 8.25%" },
  lineItems: [line(1, 100, 300, { taxable: true }), line(2, 100, 99.99, { quantity: 3, unitPrice: 33.333 }), line(3, 200, 150, { taxable: true })],
  locations: [loc(100), loc(200)],
};
const accepted: AcceptedEstimateSnapshot = { ...offered, lineItems: offered.lineItems.filter((l) => l.id !== 3) };
const at = (propertyId: number, extra: Record<string, unknown> = {}) => ({ propertyId, scheduledDate: "2026-11-10", scheduledStartTime: "09:00", durationMinutes: 120, ...extra });

test("the customer's choice is where it starts; a declined service can be added and an accepted one left out", () => {
  const plain = conversionSelection(offered, accepted, undefined);
  assert.deepEqual(plain.snapshot.lineItems.map((l) => l.id), [1, 2]);
  assert.deepEqual(plain.snapshot.locations.map((l) => l.id), [100], "a location with nothing chosen gets no job");
  const changed = conversionSelection(offered, accepted, [1, 3]);
  assert.deepEqual(changed.added, [3]);
  assert.deepEqual(changed.removed, [2]);
  assert.deepEqual(changed.snapshot.locations.map((l) => l.id), [100, 200]);
});

test("only the estimate's own services, and at least one", () => {
  assert.throws(() => conversionSelection(offered, accepted, []), /Tick at least one service/);
  assert.throws(() => conversionSelection(offered, accepted, [1, 99]), /Service #99 is not on this estimate/);
  assert.throws(() => conversionSelection(offered, accepted, ["1"]), EstimateConversionValidationError);
});

test("the end is the server's sum of start and duration; a window is told, not worked", () => {
  assert.deepEqual(resolveScheduleTimes(at(100, { scheduledEndTime: "23:00" })), { scheduledStartTime: "09:00", scheduledEndTime: "11:00", durationMinutes: 120, arrivalWindowMinutes: null });
  assert.equal(resolveScheduleTimes(at(100, { arrivalWindowMinutes: 120 })).arrivalWindowMinutes, 120);
  assert.deepEqual(resolveScheduleTimes({ propertyId: 1, scheduledDate: "2026-11-10", scheduledStartTime: "08:00", scheduledEndTime: "09:30" }).durationMinutes, 90, "older clients still send an end");
});

test("nonsense times are refused, not stored", () => {
  assert.throws(() => resolveScheduleTimes(at(1, { durationMinutes: 7 })), /15 minutes and 12 hours/);
  assert.throws(() => resolveScheduleTimes(at(1, { durationMinutes: 121 })), /5-minute steps/);
  assert.throws(() => resolveScheduleTimes(at(1, { scheduledStartTime: "23:00" })), /past midnight/);
  assert.throws(() => resolveScheduleTimes(at(1, { arrivalWindowMinutes: 20 })), /arrival window/);
  assert.throws(() => resolveScheduleTimes(at(1, { scheduledStartTime: "22:00", durationMinutes: 60, arrivalWindowMinutes: 240 })), /window would run past midnight/);
  assert.throws(() => resolveScheduleTimes({ propertyId: 1, scheduledDate: "2026-11-10", scheduledStartTime: "10:00", scheduledEndTime: "09:00" }), /end after it starts/);
});

test("the invoice made with the jobs comes to exactly what the jobs are worth", () => {
  const { snapshot } = conversionSelection(offered, accepted, [1, 2, 3]);
  const plans = buildLocationJobPlans(snapshot, [at(100), at(200, { arrivalWindowMinutes: 60 })]);
  const lines = conversionInvoiceLines(plans, [11, 12]);
  assert.equal(lines.length, 3, "one line per service");
  const invoice = calculateInvoiceLines(lines);
  const jobs = plans.reduce((sum, p) => sum + Math.round(p.totalAmount * 100) + Math.round(p.taxTotal * 100), 0);
  assert.equal(Number(invoice.totalCents), jobs);
  assert.ok(plans.every((p) => p.discountTotal > 0), "each job carries its share of the discount");
  assert.equal(lines.find((l) => l.description === "Service 2")!.quantity, "1", "3 × 33.333 is not 99.99 to the cent, so it is billed as one of its amount");
  assert.equal(lines.find((l) => l.description === "Service 2")!.taxAmount, "0.00", "not taxable");
});

test("the route: the choice, the times and the invoice are all in one transaction and one click", () => {
  const routes = read("../routes/estimates.ts");
  assert.match(routes, /quoteId, schedules, verbalAcceptance, verbalAcceptanceNote, lineItemIds, createInvoice,/);
  assert.match(routes, /const selection = conversionSelection\(/);
  assert.match(routes, /if \(createInvoice\) \{\n\s+const created = await createInvoiceCore\(/);
  assert.match(routes, /createInvoiceAdapter\(tx\)/);
  assert.match(routes, /The invoice did not come to the jobs' total/);
  assert.match(routes, /addedLineItemIds: selection\.added, removedLineItemIds: selection\.removed,/);
  assert.match(read("./estimate-conversion.ts"), /arrivalWindowMinutes: plan\.arrivalWindowMinutes,/);
});

test("migration job-arrival-window-v1 is registered after invoice-public-v1, and additive", () => {
  const list = read("../migrations/application-migrations.ts");
  assert.ok(list.indexOf("  invoicePublicV1Migration,") < list.indexOf("  jobArrivalWindowV1Migration,"));
  const migration = read("../migrations/job-arrival-window-v1.ts");
  assert.doesNotMatch(migration.slice(migration.indexOf("async function apply"), migration.indexOf("async function verify")), /\bUPDATE\b|\bDELETE\b|DROP/);
});
