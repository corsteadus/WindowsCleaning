import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { applyDiscounts, discountOf, discountsOf, shareDiscount } from "./discounts.ts";
import { acceptedSnapshotFor } from "./estimate-acceptance.ts";
import { buildLocationJobPlans, type AcceptedEstimateSnapshot } from "./estimate-conversion.ts";
import { generateInvoiceCore, type GenerateInvoiceAdapter } from "./billing-core.ts";
import { estimateDiscountsV1Migration } from "../migrations/estimate-discounts-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const senior = { name: "Senior", kind: "percent" as const, value: 10 };
const coupon = { name: "Spring coupon", kind: "amount" as const, value: 25 };

// Kyle, Video 5: dollar or percentage, named, stacked.
describe("working out discounts", () => {
  it("a percentage of the subtotal, and a dollar amount, stack", () => {
    const result = applyDiscounts(500, [senior, coupon]);
    assert.deepEqual(result.discounts.map((d) => d.amount), [50, 25]);
    assert.deepEqual([result.subtotal, result.discountTotal, result.total], [500, 75, 425]);
  });

  it("percentages do not compound: two 10% off $500 is $100 off", () => {
    assert.equal(applyDiscounts(500, [senior, { ...senior, name: "Military" }]).discountTotal, 100);
  });

  it("exact to the cent, rounded once per discount", () => {
    const result = applyDiscounts(33.33, [{ name: "Third", kind: "percent", value: 33.33 }]);
    assert.deepEqual([result.discountTotal, result.total], [11.11, 22.22]);
    assert.equal(applyDiscounts(0.1 + 0.2, []).total, 0.3);
  });

  it("a total never goes below zero: the last discount is cut to what is left", () => {
    const result = applyDiscounts(40, [coupon, coupon]);
    assert.deepEqual(result.discounts.map((d) => d.amount), [25, 15]);
    assert.equal(result.total, 0);
  });

  it("nothing priced yet, nothing taken off", () => {
    assert.deepEqual(applyDiscounts(0, [senior, coupon]).discounts.map((d) => d.amount), [0, 0]);
  });
});

describe("what a discount may be", () => {
  it("named, more than 0, and a percentage at most 100", () => {
    assert.deepEqual(discountOf({ name: " Senior ", kind: "percent", value: "10" }), { discount: senior });
    assert.ok("error" in discountOf({ name: "", kind: "percent", value: 10 }));
    assert.ok("error" in discountOf({ name: "X", kind: "percent", value: 101 }));
    assert.ok("error" in discountOf({ name: "X", kind: "amount", value: 0 }));
    assert.ok("error" in discountOf({ name: "X", kind: "half", value: 5 }));
  });

  it("a list of at most ten", () => {
    assert.deepEqual(discountsOf(undefined), { discounts: [] });
    assert.ok("error" in discountsOf(Array.from({ length: 11 }, () => senior)));
  });
});

describe("sharing a discount between locations' jobs", () => {
  it("in proportion, to the cent, always adding up", () => {
    assert.deepEqual(shareDiscount(10, [100, 50]), [6.67, 3.33]);
    assert.deepEqual(shareDiscount(0.01, [1, 1, 1]), [0.01, 0, 0]);
    const shares = shareDiscount(33.34, [10.01, 20.02, 70.07]);
    assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), 3334);
  });
});

const snapshot: AcceptedEstimateSnapshot = {
  quote: { id: 4, quoteNumber: "Q-4", customerId: 8, leadId: null, totalAmount: 135, notes: null, subtotal: 150, discountTotal: 15 },
  discounts: [{ ...senior, amount: 15 }],
  locations: [
    { id: 10, name: "Home", address: "1 A St", city: "Austin", state: "TX", zip: "78701", notes: null },
    { id: 11, name: "Shop", address: "2 B St", city: "Austin", state: "TX", zip: "78702", notes: null },
  ],
  lineItems: [
    { id: 1, serviceId: 3, description: "Exterior", quantity: 1, unitPrice: 100, totalPrice: 100, propertyId: 10, isUpsell: false, serviceNotes: null },
    { id: 2, serviceId: 4, description: "Interior", quantity: 1, unitPrice: 50, totalPrice: 50, propertyId: 11, isUpsell: false, serviceNotes: null },
  ],
};
const schedule = (propertyId: number) => ({ propertyId, scheduledDate: "2026-11-02", scheduledStartTime: "09:00", scheduledEndTime: "10:00" });

describe("the discount through acceptance, the jobs and the invoice", () => {
  it("accepting part of the estimate works the percentage out again on what was accepted", () => {
    const outcome = acceptedSnapshotFor(snapshot, [1]);
    assert.equal(outcome.acceptedTotal, 90);
    assert.deepEqual([outcome.snapshot.quote.subtotal, outcome.snapshot.quote.discountTotal], [100, 10]);
    assert.equal(outcome.snapshot.discounts?.[0].amount, 10);
  });

  it("an estimate finalized before discounts existed accepts exactly as before", () => {
    const { discounts: _none, ...old } = snapshot;
    assert.equal(acceptedSnapshotFor(old, null).acceptedTotal, 150);
  });

  it("each location's job carries its share of the discount, and its total after it", () => {
    const plans = buildLocationJobPlans(snapshot, [schedule(10), schedule(11)]);
    assert.deepEqual(plans.map((p) => [p.subtotal, p.discountTotal, p.totalAmount]), [[100, 10, 90], [50, 5, 45]]);
  });

  it("the invoice for a converted job is that job's own amount, with its discount shown", async () => {
    const inserted: any[] = [];
    const adapter: GenerateInvoiceAdapter = {
      acquireAdvisoryLock: async () => {},
      findJobById: async () => ({ id: 1, customerId: 8, propertyId: 10, quoteId: 4, jobNumber: "J-Q-4-1", status: "completed",
        totalAmount: "90.00", discountTotal: "10.00", lineItems: JSON.stringify([{ id: 1, acceptedRevisionId: 7 }]) }),
      findInvoiceByJobId: async () => null,
      findQuoteById: async () => ({ id: 4, totalAmount: "135.00" }),
      insertInvoice: async (values) => { inserted.push(values); return { id: 9, ...values } as any; },
    };
    const outcome = await generateInvoiceCore(1, adapter, { now: new Date("2026-11-03T15:00:00Z"), invoiceNumber: "INV-1" });
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    assert.deepEqual([outcome.total, outcome.gross, outcome.discount], ["90", "100.00", "10.00"]);
    assert.equal(inserted[0].totalAmount, "90");
  });

  it("a job made the old way still takes the quote's total", async () => {
    const adapter: GenerateInvoiceAdapter = {
      acquireAdvisoryLock: async () => {},
      findJobById: async () => ({ id: 1, customerId: 8, propertyId: 10, quoteId: 4, jobNumber: "J-1", status: "completed", totalAmount: "1.00", lineItems: null }),
      findInvoiceByJobId: async () => null,
      findQuoteById: async () => ({ id: 4, totalAmount: "135.00" }),
      insertInvoice: async (values) => ({ id: 9, ...values }) as any,
    };
    const outcome = await generateInvoiceCore(1, adapter, { invoiceNumber: "INV-2" });
    assert.ok(outcome.kind === "created" && outcome.total === "135" && outcome.discount === "0.00");
  });
});

describe("the wiring", () => {
  it("every change to an estimate's lines or discounts rewrites its totals in one place", () => {
    const quotes = read("../routes/quotes.ts");
    assert.match(quotes, /async function recalcQuoteTotalsTx\(tx: DrizzleTX, quoteId: number\) \{\s*await writeQuoteTotalsTx\(tx, quoteId\);/);
    assert.match(quotes, /if \(moneyChanged\) await writeQuoteTotalsTx\(tx, id\);/);
    assert.match(quotes, /else await copyProfileDiscountsTx\(tx, created\.id, requestedCustomerId\);\s*await writeQuoteTotalsTx\(tx, created\.id\);/);
    assert.match(read("../routes/estimates.ts"), /const totals = await writeQuoteTotalsTx\(tx, quoteId\);/);
  });

  it("the revision a customer sees carries the discounts", () => {
    assert.match(read("../routes/estimates.ts"), /return \{\s*discounts,\s*quote: \{/);
  });

  it("the invoice line shows the job's discount", () => {
    assert.match(read("../routes/jobs.ts"), /unitPrice: outcome\.discount === "0\.00" \? outcome\.total : outcome\.gross,\s*discountAmount: outcome\.discount,/);
  });

  it("a profile's discount is only its own, and technicians never see them", () => {
    const route = read("../routes/profile-discounts.ts");
    assert.match(route, /eq\(customerDiscountsTable\.id, discountId\), eq\(customerDiscountsTable\.customerId, id\)/);
    assert.match(route, /isAssignmentScopedOperationalRole\(req\.user\?\.role\)/);
  });

  it("the migration only adds two tables and a zero-default column, and is registered", async () => {
    const calls: string[] = [];
    let tables = 0;
    let column = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.tables")) return { rows: [{ count: tables }] };
      if (text.includes("information_schema.columns")) return { rows: [{ count: column }] };
      if (text.startsWith("CREATE TABLE")) tables += 1;
      if (text.startsWith("ALTER TABLE jobs ADD COLUMN")) column = 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await estimateDiscountsV1Migration.preflight(context);
    await estimateDiscountsV1Migration.apply(context, pre);
    await estimateDiscountsV1Migration.verify(context);
    assert.ok(calls.some((call) => /discount_total numeric\(10, 2\) NOT NULL DEFAULT 0/.test(call)));
    assert.ok(!calls.some((call) => /UPDATE |DELETE FROM/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(estimateDiscountsV1Migration as never));
  });
});
