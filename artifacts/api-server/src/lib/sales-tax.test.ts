import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { combinedRate, countyKey, salesTax, taxRateOf } from "./sales-tax.ts";
import { acceptedSnapshotFor } from "./estimate-acceptance.ts";
import { buildLocationJobPlans, type AcceptedEstimateSnapshot } from "./estimate-conversion.ts";
import { generateInvoiceCore, type GenerateInvoiceAdapter } from "./billing-core.ts";
import { planBulkInvoices } from "./bulk-invoice.ts";
import { salesTaxV1Migration } from "../migrations/sales-tax-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Kyle #2 (2026-10-26): state and county rates, alone or added together; Taxable per service.
describe("working out sales tax", () => {
  it("only taxable lines are taxed", () => {
    const tax = salesTax([{ totalPrice: 300, taxable: true }, { totalPrice: 200, taxable: false }], 0, 5);
    assert.deepEqual([tax.taxableBase, tax.tax], [300, 15]);
  });

  it("on the amount after discounts, the discount shared by each part's amount", () => {
    // $50 off $500: $30 of it falls on the $300 taxable part.
    assert.deepEqual(salesTax([{ totalPrice: 300, taxable: true }, { totalPrice: 200, taxable: false }], 50, 10), { taxableBase: 270, tax: 27, rate: 10 });
  });

  it("rounded once, to the cent", () => {
    assert.equal(salesTax([{ totalPrice: 99.99, taxable: true }], 0, 8.475).tax, 8.47);
  });

  it("no rate, no tax; nothing taxable, no tax", () => {
    assert.equal(salesTax([{ totalPrice: 100, taxable: true }], 0, null).tax, 0);
    assert.equal(salesTax([{ totalPrice: 100, taxable: false }], 0, 7).tax, 0);
  });

  it("a state rate and a county rate add together, and read as both", () => {
    assert.deepEqual(combinedRate([{ name: "Missouri", rate: 4.225 }, { name: "Jackson County", rate: 1.25 }]),
      { rate: 5.475, label: "Missouri 4.225% + Jackson County 1.25%" });
  });

  it("a county is matched however it is written", () => {
    assert.equal(countyKey("Jackson County"), countyKey("jackson"));
    assert.equal(countyKey("St. Louis Co."), countyKey("St Louis"));
  });

  it("a rate needs a name, a two-letter state, a county for a county rate, and 0 < rate <= 20", () => {
    assert.ok("rate" in taxRateOf({ name: "Missouri", kind: "state", state: "mo", rate: "4.225" }));
    assert.ok("error" in taxRateOf({ name: "Jackson", kind: "county", state: "MO", rate: 1.25 }));
    assert.ok("error" in taxRateOf({ name: "X", kind: "state", state: "Missouri", rate: 4 }));
    assert.ok("error" in taxRateOf({ name: "X", kind: "state", state: "MO", rate: 25 }));
  });
});

const snapshot: AcceptedEstimateSnapshot = {
  quote: { id: 4, quoteNumber: "Q-4", customerId: 8, leadId: null, totalAmount: 474, notes: null, subtotal: 500, discountTotal: 50, taxTotal: 24 },
  discounts: [{ name: "Senior", kind: "percent", value: 10, amount: 50 }],
  tax: { rate: 10, label: "Test 10%" },
  locations: [
    { id: 10, name: "Home", address: "1 A St", city: "KC", state: "MO", zip: "64111", notes: null },
    { id: 11, name: "Lake", address: "2 B St", city: "KC", state: "MO", zip: "64112", notes: null },
  ],
  lineItems: [
    { id: 1, serviceId: 3, description: "Windows", quantity: 1, unitPrice: 300, totalPrice: 300, propertyId: 10, isUpsell: false, serviceNotes: null, taxable: false },
    { id: 2, serviceId: 4, description: "Screens (materials)", quantity: 1, unitPrice: 200, totalPrice: 200, propertyId: 11, isUpsell: false, serviceNotes: null, taxable: true },
  ],
};
const schedule = (propertyId: number) => ({ propertyId, scheduledDate: "2026-11-02", scheduledStartTime: "09:00", scheduledEndTime: "10:00" });

describe("the tax through acceptance, the jobs and the invoice", () => {
  it("the accepted total includes the tax on what was accepted", () => {
    // Everything: $450 after the discount; taxable $200 − its $20 share = $180, at 10% = $18.
    assert.equal(acceptedSnapshotFor(snapshot, null).acceptedTotal, 468);
    // Only the taxable line: $200 − $20 = $180, + $18.
    const part = acceptedSnapshotFor(snapshot, [2]);
    assert.deepEqual([part.acceptedTotal, part.snapshot.quote.taxTotal], [198, 18]);
  });

  it("a revision from before sales tax accepts with no tax", () => {
    const { tax: _none, ...old } = snapshot;
    assert.equal(acceptedSnapshotFor(old, null).acceptedTotal, 450);
  });

  it("each location's job carries the tax on its own taxable work", () => {
    const plans = buildLocationJobPlans(snapshot, [schedule(10), schedule(11)]);
    assert.deepEqual(plans.map((p) => [p.totalAmount, p.taxTotal]), [[270, 0], [180, 18]]);
  });

  it("the job's invoice adds its tax, on the line and in the header", async () => {
    const inserted: any[] = [];
    const adapter: GenerateInvoiceAdapter = {
      acquireAdvisoryLock: async () => {},
      findJobById: async () => ({ id: 2, customerId: 8, propertyId: 11, quoteId: 4, jobNumber: "J-Q-4-2", status: "completed",
        totalAmount: "180.00", discountTotal: "20.00", taxTotal: "18.00", lineItems: JSON.stringify([{ id: 2, acceptedRevisionId: 7 }]) }),
      findInvoiceByJobId: async () => null,
      findQuoteById: async () => ({ id: 4, totalAmount: "468.00" }),
      insertInvoice: async (values) => { inserted.push(values); return { id: 9, ...values } as any; },
    };
    const outcome = await generateInvoiceCore(2, adapter, { invoiceNumber: "INV-T" });
    assert.ok(outcome.kind === "created");
    if (outcome.kind !== "created") return;
    assert.deepEqual([outcome.gross, outcome.discount, outcome.tax, outcome.total], ["200.00", "20.00", "18.00", "198"]);
    assert.deepEqual([inserted[0].subtotal, inserted[0].taxAmount, inserted[0].totalAmount], ["180", "18.00", "198"]);
  });
});

describe("bulk invoicing", () => {
  it("a week's invoice adds each job's sales tax to its total", () => {
    const result = planBulkInvoices({ from: "2026-11-02", to: "2026-11-08", jobs: [
      { id: 1, customerId: 8, customerLabel: "Lute", jobNumber: "J-1", scheduledDate: "2026-11-03", status: "completed", serviceType: "Windows", totalAmount: "180.00", taxTotal: "18.00", hasInvoice: false, propertyId: 11 },
      { id: 2, customerId: 8, customerLabel: "Lute", jobNumber: "J-2", scheduledDate: "2026-11-04", status: "completed", serviceType: "Gutters", totalAmount: "100.00", taxTotal: "0.00", hasInvoice: false, propertyId: 11 },
    ] } as never) as any;
    assert.ok(result.ok, JSON.stringify(result));
    const plan = result.plan;
    assert.equal(plan.groups[0].totalCents, 29800);
    assert.deepEqual(plan.groups[0].lines.map((l: any) => l.taxCents ?? 0), [1800, 0]);
  });
});

describe("the wiring", () => {
  it("the estimate's total is after discounts, plus tax, and never for a Tax Exempt customer", () => {
    const totals = read("./quote-totals.ts");
    assert.match(totals, /const rate = quote\?\.taxExempt \? null : quote\?\.taxRate == null \? null : Number\(quote\.taxRate\);/);
    assert.match(totals, /if \(customer\?\.taxExempt\) return \{ error: "This customer is Tax Exempt, so the estimate cannot charge sales tax" \};/);
    assert.match(read("../routes/estimates.ts"), /tax: quote\.taxRate == null \|\| taxExempt \? null :/);
  });

  it("tax is never on by default: a new estimate charges it only when told", () => {
    assert.match(read("../routes/quotes.ts"), /const taxChoice = await taxChoiceOf\(tx, body\.tax \?\? null, requestedCustomerId\);/);
  });

  it("a new line is taxed as its service is set up, unless the sender says", () => {
    assert.match(read("../routes/quotes.ts"), /taxableByService\.get\(Number\(li\.serviceId\)\) \?\? false/);
  });

  it("a Tax Exempt customer's invoice cannot carry sales tax", () => {
    assert.match(read("../routes/invoices.ts"), /if \(customer\?\.taxExempt\) \{\s*res\.status\(400\)\.json\(\{ error: "This customer is Tax Exempt, so the invoice cannot charge sales tax"/);
  });

  it("anyone who sees estimates reads the rates; only an administrator sets them", () => {
    const auth = read("./authorization.ts");
    assert.match(auth, /\{ prefix: "\/tax-rates", methods: \["GET"\], capability: "quotes\.view" \}/);
    assert.match(auth, /\{ prefix: "\/tax-rates", capability: "admin\.settings" \}/);
  });

  it("the migration adds one table and columns that mean no tax, and is registered", async () => {
    const calls: string[] = [];
    let tables = 0;
    let columns = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.tables")) return { rows: [{ count: tables }] };
      if (text.includes("information_schema.columns")) return { rows: [{ count: columns }] };
      if (text.startsWith("CREATE TABLE")) tables += 1;
      if (/^ALTER TABLE \w+ ADD COLUMN/.test(text)) columns += 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await salesTaxV1Migration.preflight(context);
    await salesTaxV1Migration.apply(context, pre);
    await salesTaxV1Migration.verify(context);
    assert.ok(calls.some((call) => /services ADD COLUMN taxable boolean NOT NULL DEFAULT false/.test(call)));
    assert.ok(!calls.some((call) => /UPDATE |DELETE FROM/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(salesTaxV1Migration as never));
  });
});
