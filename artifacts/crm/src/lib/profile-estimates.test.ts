import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { convertBlocker, estimatePriceLabel, type ProfileEstimate } from "./profile-estimates.ts";
import { finalizeBody } from "./estimate-actions.ts";
import { conversionBlockers } from "./conversion-readiness.ts";

const estimate = (patch: Partial<ProfileEstimate> = {}, summary: Partial<NonNullable<ProfileEstimate["summary"]>> = {}): ProfileEstimate => ({
  id: 1, quoteNumber: "Q-1", status: "draft", totalAmount: "250.00", createdAt: "2026-10-01T00:00:00Z",
  summary: { locations: [], estimator: null, appointmentAt: null, lineCount: 2, pendingCount: 0, revisionNumber: null, jobCount: 0, ...summary },
  ...patch,
});
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the profile's estimates — Kyle, Videos 4 and 5", () => {
  it("an estimate with nothing priced yet reads To be quoted, never $0.00", () => {
    assert.equal(estimatePriceLabel(estimate({ totalAmount: "0.00" }, { pendingCount: 2 })), "To be quoted");
    assert.equal(estimatePriceLabel(estimate({}, { pendingCount: 1 })), "$250.00 · 1 to be quoted");
    assert.equal(estimatePriceLabel(estimate()), "$250.00");
    assert.equal(estimatePriceLabel(estimate({ totalAmount: "0.00" })), "$0.00", "$0 is a real price (Kyle, 2026-10-24)");
    assert.equal(estimatePriceLabel(estimate({}, { lineCount: 0 })), "No services");
  });

  it("says why an estimate cannot be scheduled yet", () => {
    assert.equal(convertBlocker(estimate()), null);
    assert.match(convertBlocker(estimate({}, { pendingCount: 1 }))!, /1 service is still to be quoted/);
    assert.match(convertBlocker(estimate({}, { lineCount: 0 }))!, /Add a service/);
    assert.match(convertBlocker(estimate({ displayStatus: "declined" }))!, /declined/);
    assert.match(convertBlocker(estimate({}, { jobCount: 1 }))!, /already been scheduled/);
  });

  it("finalizing from the profile keeps each line's location, description and blank price", () => {
    const body = finalizeBody({
      notes: "n", terms: null, propertyId: 10,
      lineItems: [
        { description: "Windows", quantity: 1, unitPrice: null, serviceNotes: "All exterior", propertyId: 11 },
        { description: "Screens", quantity: 1, unitPrice: 0 },
      ],
    });
    assert.deepEqual(body.lineItems.map((line) => [line.unitPrice, line.propertyId, line.serviceNotes]), [
      [null, 11, "All exterior"], [0, 10, null],
    ]);
  });

  it("the scheduling dialog says first that a service still needs a price", () => {
    const blockers = conversionBlockers({
      locationCount: 1, rows: [], requiresVerbalAcceptance: true, verbalRecorded: false, verbalNote: "",
      unpriced: "Add a price before sending: Windows",
    });
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /Windows\. Open the estimate, add the price/);
  });

  it("a prospect can be converted from the header and from each estimate", () => {
    const detail = read("../pages/CustomerDetail.tsx");
    assert.match(detail, /customer\.lifecycleStatus === "prospect" && \(customer\.quotes \?\? \[\]\)\.length > 0[\s\S]{0,700}Convert to Customer/);
    assert.match(detail, /<ConvertFromEstimateDialog/);
    assert.match(detail, /<EstimateConversionDialog[\s\S]{0,120}hideTrigger/);
    assert.match(read("../components/ProfileEstimates.tsx"), /aria-label=\{`Convert \$\{quote\.quoteNumber\}`\}/);
  });
});
