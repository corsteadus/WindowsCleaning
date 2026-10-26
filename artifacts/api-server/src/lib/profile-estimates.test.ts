import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { summarizeEstimates } from "./profile-estimates.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const base = {
  quotes: [{ id: 1, propertyId: 10 }, { id: 2, propertyId: null }],
  appointments: [{ quoteId: 1, startsAt: "2027-03-16T20:00:00.000Z", assignedUserId: "u1" }],
  users: [{ id: "u1", firstName: "Team", lastName: "Tech", username: "team_tech" }],
  locations: [{ quoteId: 1, propertyId: 10 }],
  lines: [
    { quoteId: 1, propertyId: 10, pricePending: false },
    { quoteId: 1, propertyId: 11, pricePending: true },
  ],
  revisions: [{ quoteId: 1, revisionNumber: 1 }, { quoteId: 1, revisionNumber: 2 }],
  jobs: [],
  properties: [
    { id: 10, name: "Primary service property", address: "4818 W 132nd St" },
    { id: 11, name: "Mom's house", address: "100 Main St" },
  ],
};

// Kyle, Videos 4 and 5: price, locations and who it was assigned to.
describe("each estimate as the profile lists it", () => {
  it("says where, who and when", () => {
    const one = summarizeEstimates(base).get(1)!;
    assert.deepEqual(one.locations, [{ id: 10, label: "4818 W 132nd St" }, { id: 11, label: "Mom's house" }],
      "a location by its own name, else its street — never \"Primary service property\"");
    assert.equal(one.estimator, "Team Tech");
    assert.equal(one.appointmentAt, "2027-03-16T20:00:00.000Z");
  });

  it("counts the lines still to be quoted, and knows the latest revision", () => {
    const one = summarizeEstimates(base).get(1)!;
    assert.deepEqual([one.lineCount, one.pendingCount, one.revisionNumber, one.jobCount], [2, 1, 2, 0]);
  });

  it("an estimate with nothing booked and never finalized says so", () => {
    const two = summarizeEstimates(base).get(2)!;
    assert.deepEqual([two.estimator, two.appointmentAt, two.revisionNumber, two.locations], [null, null, null, []]);
  });

  it("knows when jobs were already made from it", () => {
    assert.equal(summarizeEstimates({ ...base, jobs: [{ quoteId: 1 }, { quoteId: 1 }] }).get(1)!.jobCount, 2);
  });
});

describe("no job is made from a service still to be quoted", () => {
  const route = read("../routes/estimates.ts");
  it("the conversion refuses, and the preview says so first", () => {
    assert.match(route, /const unpriced = unpricedRefusal\(\(snapshot\.lineItems \?\? \[\]\) as PricedLine\[\]\);\s*if \(unpriced\) \{/);
    assert.match(route, /if \(result\.kind === "unpriced"\) return res\.status\(409\)\.json\(\{ error: result\.message, code: "estimate_unpriced" \}\);/);
    assert.match(route, /unpriced: unpricedRefusal\(\(snapshot\.lineItems \?\? \[\]\) as PricedLine\[\]\),/);
  });

  it("the profile route sends each estimate's summary", () => {
    assert.match(read("../routes/customers.ts"), /summary: estimateSummaries\.get\(q\.id\) \?\? null,/);
  });
});
