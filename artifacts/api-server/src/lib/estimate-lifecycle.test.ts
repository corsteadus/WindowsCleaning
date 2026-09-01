import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertActiveEstimateRevision, assertDecisionTransition, assertStaffWritableQuoteStatus, deriveEstimateStatus, isOpenEstimateStatus, isTerminalEstimateStatus } from "./estimate-lifecycle.ts";

describe("estimate lifecycle", () => {
  it("derives every supported status and derives accepted & scheduled from a job", () => {
    assert.equal(deriveEstimateStatus({ hasAppointment: true }), "scheduled");
    assert.equal(deriveEstimateStatus({ hasFinalizedRevision: true }), "draft");
    assert.equal(deriveEstimateStatus({ sentAt: new Date() }), "sent");
    assert.equal(deriveEstimateStatus({ sentAt: new Date(), firstOpenedAt: new Date() }), "viewed");
    assert.equal(deriveEstimateStatus({ decision: "accepted" }), "accepted");
    assert.equal(deriveEstimateStatus({ decision: "accepted", hasLinkedJob: true }), "accepted_scheduled");
    assert.equal(deriveEstimateStatus({ decision: "declined" }), "declined");
  });
  it("keeps Open as a filter and makes decisions idempotent but not reversible", () => {
    assert.equal(isOpenEstimateStatus("viewed"), true);
    assert.equal(isOpenEstimateStatus("accepted"), false);
    assert.equal(assertDecisionTransition("accepted", "accepted"), "idempotent");
    assert.throws(() => assertDecisionTransition("accepted", "declined"), /already accepted/);
  });
  it("reserves acceptance for the secure customer decision flow", () => {
    assert.doesNotThrow(() => assertStaffWritableQuoteStatus("draft"));
    assert.throws(() => assertStaffWritableQuoteStatus("accepted"), /secure customer decision flow/);
    assert.throws(() => assertStaffWritableQuoteStatus("approved"), /secure customer decision flow/);
    assert.equal(isTerminalEstimateStatus("approved"), true);
  });
  it("rejects customer decisions made from a superseded revision", () => {
    assert.doesNotThrow(() => assertActiveEstimateRevision(3, 3));
    assert.throws(() => assertActiveEstimateRevision(2, 3), /superseded/);
  });
});