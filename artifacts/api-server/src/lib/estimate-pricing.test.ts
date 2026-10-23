import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { priceOf, shownPrice, unpricedLines, unpricedRefusal } from "./estimate-pricing.ts";

// Kyle, 2026-10-24: "Blank price … cannot be sent. $0.00: this is a valid price."
describe("blank is not priced; $0 is a price", () => {
  it("a blank, null or missing price is pending; 0 and more are prices", () => {
    for (const blank of [null, undefined, "", "  "]) assert.deepEqual(priceOf(blank), { unitPrice: 0, pricePending: true });
    assert.deepEqual(priceOf(0), { unitPrice: 0, pricePending: false });
    assert.deepEqual(priceOf("0.00"), { unitPrice: 0, pricePending: false });
    assert.deepEqual(priceOf(250), { unitPrice: 250, pricePending: false });
    assert.ok("error" in priceOf(-1));
    assert.ok("error" in priceOf("abc"));
  });

  it("a pending line reads back as null, so a round trip keeps it pending", () => {
    assert.equal(shownPrice({ unitPrice: "0.00", pricePending: true }), null);
    assert.equal(shownPrice({ unitPrice: "0.00", pricePending: false }), 0);
  });

  it("names every line still to be quoted, and lets $0 through", () => {
    assert.deepEqual(unpricedLines([
      { description: "Windows", unitPrice: 250 }, { description: "Screens", unitPrice: 0 },
      { description: "Gutters", unitPrice: null }, { description: "", unitPrice: 0, pricePending: true },
    ]), ["Gutters", "Line 4"]);
  });
});

describe("an estimate is never sent with a service still to be quoted", () => {
  it("refuses in words, and lets a priced estimate go — $0 included", () => {
    assert.equal(unpricedRefusal([{ description: "Gutters", unitPrice: null }]), "Add a price before sending: Gutters");
    assert.equal(unpricedRefusal([{ description: "Screens", unitPrice: 0 }]), null);
    assert.equal(unpricedRefusal([{ description: "Windows", unitPrice: "250.00" }]), null);
    assert.match(unpricedRefusal([])!, /Add a service/);
  });

  it("the send route checks the finalized snapshot, which is what the customer receives", () => {
    const route = readFileSync(fileURLToPath(new URL("../routes/estimates.ts", import.meta.url)), "utf8");
    assert.match(route, /const unpriced = unpricedRefusal\(\(\(revision\.snapshot as any\)\?\.lineItems \?\? \[\]\) as PricedLine\[\]\);\s*if \(unpriced\) return res\.status\(400\)\.json\(\{ error: unpriced, code: "estimate_unpriced" \}\);/);
  });
});

// Found 2026-10-23 while building B2: the estimate page sent no descriptions to
// Finalize, and Finalize replaced the lines, so every finalized estimate lost
// its customer-visible descriptions (#31).
describe("Finalize never quietly wipes a line's description or location", () => {
  const estimates = readFileSync(fileURLToPath(new URL("../routes/estimates.ts", import.meta.url)), "utf8");
  const detail = readFileSync(fileURLToPath(new URL("../../../crm/src/pages/QuoteDetail.tsx", import.meta.url)), "utf8");

  it("what a sender leaves out is carried over from the line it replaces", () => {
    assert.match(estimates, /serviceNotes: lines\[i\]\.serviceNotes === undefined \? previous\?\.serviceNotes \?\? null/);
    assert.match(estimates, /propertyId: lines\[i\]\.propertyId === undefined \? previous\?\.propertyId \?\? null/);
  });

  it("the estimate page sends both anyway", () => {
    assert.match(detail, /serviceNotes: line\.serviceNotes \?\? null, propertyId: line\.propertyId \?\? quote\.propertyId/);
  });
});
