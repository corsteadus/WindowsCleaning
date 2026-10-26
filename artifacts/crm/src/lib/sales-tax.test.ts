import assert from "node:assert/strict";
import { test } from "node:test";

import { salesTax, suggestedRates } from "./sales-tax.ts";

// The same cases as the server's lib/sales-tax.test.ts: both must agree to the cent.
test("the browser works the tax out exactly as the server does", () => {
  assert.equal(salesTax([{ totalPrice: 300, taxable: true }, { totalPrice: 200, taxable: false }], 0, 5).tax, 15);
  assert.deepEqual(salesTax([{ totalPrice: 300, taxable: true }, { totalPrice: 200, taxable: false }], 50, 10).tax, 27);
  assert.equal(salesTax([{ totalPrice: 99.99, taxable: true }], 0, 8.475).tax, 8.47);
  assert.equal(salesTax([{ totalPrice: 100, taxable: true }, { totalPrice: 100, taxable: false }, { totalPrice: 100, taxable: true }], 0.01, 10).taxableBase, 199.99);
  assert.equal(salesTax([{ totalPrice: 100, taxable: true }], 0, null).tax, 0);
});

test("a location is offered its state's rate and its county's", () => {
  const rates = [
    { id: 1, name: "Missouri", kind: "state" as const, state: "MO", county: null, rate: 4.225, isActive: true },
    { id: 2, name: "Jackson County", kind: "county" as const, state: "MO", county: "Jackson County", rate: 1.25, isActive: true },
    { id: 3, name: "Kansas", kind: "state" as const, state: "KS", county: null, rate: 6.5, isActive: false },
  ];
  assert.deepEqual(Object.values(suggestedRates(rates, { state: "mo", county: "jackson" })).map((r) => r?.id), [1, 2]);
  assert.deepEqual(Object.values(suggestedRates(rates, { state: "KS", county: null })).map((r) => r?.id ?? null), [null, null]);
});

test("2,000 random estimates: the browser and the server agree to the cent", async () => {
  const server = await import("../../../api-server/src/lib/sales-tax.ts");
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2000; i += 1) {
    const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({ totalPrice: Math.round(rand() * 100000) / 100, taxable: rand() > 0.5 }));
    const whole = lines.reduce((sum, l) => sum + Math.round(l.totalPrice * 100), 0) / 100;
    const discount = Math.round(rand() * whole * 100) / 100;
    const rate = Math.round(rand() * 120000) / 10000;
    assert.deepEqual(salesTax(lines, discount, rate), server.salesTax(lines, discount, rate), JSON.stringify({ lines, discount, rate }));
  }
});
