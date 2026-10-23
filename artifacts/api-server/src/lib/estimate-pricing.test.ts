import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { unpricedLines, unpricedRefusal } from "./estimate-pricing.ts";

describe("an estimate is never sent at $0 — B2, 2026-10-23", () => {
  it("names every line still to be quoted", () => {
    assert.deepEqual(unpricedLines([
      { description: "Windows", unitPrice: 250 }, { description: "Gutters", unitPrice: 0 }, { description: "", unitPrice: "0" },
    ]), ["Gutters", "Line 3"]);
  });

  it("refuses in words, and lets a fully priced estimate go", () => {
    assert.equal(unpricedRefusal([{ description: "Gutters", unitPrice: 0 }]), "Add a price before sending: Gutters");
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
