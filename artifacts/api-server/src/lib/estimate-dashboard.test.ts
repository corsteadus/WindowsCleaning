import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  ESTIMATE_GROUPS, ESTIMATE_GROUP_LABELS, groupOfStatus, summariseEstimates,
} from "./estimate-dashboard.ts";
import { ESTIMATE_STATUSES } from "./estimate-lifecycle.ts";

describe("groupOfStatus", () => {
  it("puts every status the system can derive into a grouping", () => {
    for (const status of ESTIMATE_STATUSES) {
      assert.ok(ESTIMATE_GROUPS.includes(groupOfStatus(status)), `${status} fell outside the groupings`);
    }
  });

  it("reads Kyle's six groupings the way the module documents", () => {
    assert.equal(groupOfStatus("draft"), "open");
    assert.equal(groupOfStatus("scheduled"), "open");
    assert.equal(groupOfStatus("sent"), "pending");
    assert.equal(groupOfStatus("viewed"), "pending");
    assert.equal(groupOfStatus("accepted"), "accepted");
    assert.equal(groupOfStatus("accepted_scheduled"), "accepted_scheduled");
    assert.equal(groupOfStatus("declined"), "declined");
    assert.equal(groupOfStatus("expired"), "closed");
  });

  it("treats an unknown or missing status as Open rather than dropping it", () => {
    assert.equal(groupOfStatus("something_new"), "open");
    assert.equal(groupOfStatus(null), "open");
    assert.equal(groupOfStatus(undefined), "open");
  });

  it("names the groupings as Kyle wrote them", () => {
    assert.equal(ESTIMATE_GROUP_LABELS.accepted_scheduled, "Accepted & Scheduled");
  });
});

describe("summariseEstimates", () => {
  it("counts each grouping and keeps them all, including the empty ones", () => {
    const summary = summariseEstimates([
      { id: 1, status: "draft" }, { id: 2, status: "sent" }, { id: 3, status: "viewed" },
      { id: 4, status: "accepted" }, { id: 5, status: "accepted_scheduled" }, { id: 6, status: "declined" },
    ]);
    assert.equal(summary.groups.length, 6, "an empty grouping still has to show, or the module moves about");
    assert.deepEqual(summary.groups.map((g) => g.count), [1, 2, 1, 1, 1, 0]);
    assert.equal(summary.total, 6);
  });

  it("counts what the office has to act on", () => {
    const summary = summariseEstimates([
      { id: 1, status: "accepted" }, { id: 2, status: "accepted" }, { id: 3, status: "accepted" },
      { id: 4, status: "accepted_scheduled" },
    ]);
    assert.equal(summary.needsScheduling, 3, "one is already scheduled and needs nothing");
    assert.equal(summary.needsSchedulingLabel, "3 estimates need to be scheduled");
  });

  it("says it in the singular for one", () => {
    const summary = summariseEstimates([{ id: 1, status: "accepted" }]);
    assert.equal(summary.needsSchedulingLabel, "1 estimate needs to be scheduled");
  });

  it("says nothing at all when there is nothing to do", () => {
    const summary = summariseEstimates([{ id: 1, status: "accepted_scheduled" }, { id: 2, status: "declined" }]);
    assert.equal(summary.needsScheduling, 0);
    assert.equal(summary.needsSchedulingLabel, null);
  });

  it("handles an office with no estimates at all", () => {
    const summary = summariseEstimates([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.needsSchedulingLabel, null);
    assert.deepEqual(summary.groups.map((g) => g.count), [0, 0, 0, 0, 0, 0]);
  });

  it("keeps the groupings in the order Kyle listed them", () => {
    const summary = summariseEstimates([]);
    assert.deepEqual(summary.groups.map((g) => g.label),
      ["Open", "Pending", "Accepted", "Accepted & Scheduled", "Declined", "Closed"]);
  });
});
