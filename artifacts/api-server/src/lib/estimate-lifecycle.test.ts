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
describe("estimate statuses", () => {
// ── Random Edits #4: the V1 statuses, expiry, and manual corrections ────────
  it("an undecided estimate expires once its date passes", async () => {
  const { deriveEstimateStatus } = await import("./estimate-lifecycle.ts");
  const now = new Date("2026-09-24T12:00:00Z");
  const sent = { sentAt: "2026-09-01T09:00:00Z", now };
  assert.equal(deriveEstimateStatus({ ...sent, expiresAt: "2026-09-20T09:00:00Z" }), "expired");
  assert.equal(deriveEstimateStatus({ ...sent, expiresAt: "2026-10-20T09:00:00Z" }), "sent");
  // viewed but never answered, and now past the date
  assert.equal(deriveEstimateStatus({ ...sent, firstOpenedAt: "2026-09-02T09:00:00Z", expiresAt: "2026-09-20T09:00:00Z" }), "expired");
  });

  it("the expiry moment itself counts as expired, and a bad date never does", async () => {
  const { deriveEstimateStatus } = await import("./estimate-lifecycle.ts");
  const now = new Date("2026-09-24T12:00:00Z");
  assert.equal(deriveEstimateStatus({ sentAt: "2026-09-01", expiresAt: now, now }), "expired");
  assert.equal(deriveEstimateStatus({ sentAt: "2026-09-01", expiresAt: "not a date", now }), "sent");
  assert.equal(deriveEstimateStatus({ sentAt: "2026-09-01", expiresAt: null, now }), "sent");
  });

  it("a decision outranks the expiry date and any correction", async () => {
  const { deriveEstimateStatus } = await import("./estimate-lifecycle.ts");
  const now = new Date("2026-09-24T12:00:00Z");
  const past = "2026-09-20T09:00:00Z";
  assert.equal(deriveEstimateStatus({ decision: "accepted", expiresAt: past, now }), "accepted");
  assert.equal(deriveEstimateStatus({ decision: "accepted", expiresAt: past, hasLinkedJob: true, now }), "accepted_scheduled");
  assert.equal(deriveEstimateStatus({ decision: "declined", expiresAt: past, now }), "declined");
  // a correction cannot talk over the customer's own acceptance
  assert.equal(deriveEstimateStatus({ decision: "accepted", legacyStatus: "declined", now }), "accepted");
  });

  it("a correction an employee made by hand survives the automatic rules", async () => {
  const { deriveEstimateStatus } = await import("./estimate-lifecycle.ts");
  const now = new Date("2026-09-24T12:00:00Z");
  // marked expired although the link is still in date
  assert.equal(deriveEstimateStatus({ legacyStatus: "expired", sentAt: "2026-09-01", expiresAt: "2026-10-20", now }), "expired");
  // marked viewed although the customer never opened it
  assert.equal(deriveEstimateStatus({ legacyStatus: "viewed", sentAt: "2026-09-01", now }), "viewed");
  assert.equal(deriveEstimateStatus({ legacyStatus: "declined", sentAt: "2026-09-01", now }), "declined");
  });

  // Kyle #23 reverses the earlier rule. The office may now record an
  // acceptance that happened on the phone, because without it an accepted
  // estimate can never become a job (his #15).
  it("an employee may correct a status to Accepted, but not to a derived shade", async () => {
  const { MANUALLY_CORRECTABLE_STATUSES, isManuallyCorrectableStatus } = await import("./estimate-lifecycle.ts");
  assert.deepEqual([...MANUALLY_CORRECTABLE_STATUSES], ["draft", "sent", "viewed", "accepted", "declined", "expired"]);
  assert.equal(isManuallyCorrectableStatus("accepted"), true);
  // These two are derived from facts, never typed: "scheduled" means an
  // appointment exists, "accepted_scheduled" means a job was created.
  assert.equal(isManuallyCorrectableStatus("accepted_scheduled"), false);
  assert.equal(isManuallyCorrectableStatus("scheduled"), false);
  assert.equal(isManuallyCorrectableStatus("nonsense"), false);
  for (const status of MANUALLY_CORRECTABLE_STATUSES) assert.equal(isManuallyCorrectableStatus(status), true);
  });

  it("only Accepted has to say why", async () => {
  const { correctionRequiresReason, MANUALLY_CORRECTABLE_STATUSES } = await import("./estimate-lifecycle.ts");
  assert.equal(correctionRequiresReason("accepted"), true);
  for (const status of MANUALLY_CORRECTABLE_STATUSES.filter((s) => s !== "accepted")) {
    assert.equal(correctionRequiresReason(status), false, `${status} should not demand a reason`);
  }
  });

  it("a corrected acceptance is an acceptance the conversion screen honours", async () => {
  const { isAcceptedEstimate } = await import("./estimate-conversion.ts");
  // The whole point of #23: this is what unblocks #15.
  assert.equal(isAcceptedEstimate("accepted", false), true);
  assert.equal(isAcceptedEstimate("approved", false), true);
  assert.equal(isAcceptedEstimate("draft", true), true);
  assert.equal(isAcceptedEstimate("draft", false), false);
  assert.equal(isAcceptedEstimate("sent", false), false);
  assert.equal(isAcceptedEstimate("declined", false), false);
  });

  it("every status Kyle listed for V1 exists", async () => {
  const { ESTIMATE_STATUSES } = await import("./estimate-lifecycle.ts");
  for (const status of ["draft", "sent", "viewed", "accepted", "declined", "expired"]) {
    assert.ok(ESTIMATE_STATUSES.includes(status as never), `${status} is missing`);
  }
  });
});
