import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleChangeLock,
  scheduleLockMessage,
  touchesSchedule,
  type ScheduleFieldChanges,
} from "./schedule-change-lock.ts";

const NO_CHANGES: ScheduleFieldChanges = {
  scheduledDate: false,
  scheduledStartTime: false,
  scheduledEndTime: false,
};
const MOVED_DATE: ScheduleFieldChanges = { ...NO_CHANGES, scheduledDate: true };

test("a scheduled job may be moved", () => {
  assert.equal(
    scheduleChangeLock({ currentStatus: "scheduled", hasInvoice: false, changes: MOVED_DATE }),
    null,
  );
});

test("a completed job may not be moved", () => {
  assert.equal(
    scheduleChangeLock({ currentStatus: "completed", hasInvoice: false, changes: MOVED_DATE }),
    "completed",
  );
});

test("an invoiced job may not be moved even while still scheduled", () => {
  assert.equal(
    scheduleChangeLock({ currentStatus: "scheduled", hasInvoice: true, changes: MOVED_DATE }),
    "invoiced",
  );
});

test("each schedule field is guarded, not just the date", () => {
  for (const field of ["scheduledDate", "scheduledStartTime", "scheduledEndTime"] as const) {
    assert.equal(
      scheduleChangeLock({
        currentStatus: "completed",
        hasInvoice: false,
        changes: { ...NO_CHANGES, [field]: true },
      }),
      "completed",
      `${field} must be guarded`,
    );
  }
});

test("resending an unchanged job is not a reschedule", () => {
  // The reschedule dialog always posts all three fields. A completed job that
  // is saved without edits must not be reported as an attempted move.
  assert.equal(
    scheduleChangeLock({ currentStatus: "completed", hasInvoice: true, changes: NO_CHANGES }),
    null,
  );
  assert.equal(touchesSchedule(NO_CHANGES), false);
  assert.equal(touchesSchedule(MOVED_DATE), true);
});

test("reopening and moving in one request is allowed", () => {
  assert.equal(
    scheduleChangeLock({
      currentStatus: "completed",
      requestedStatus: "scheduled",
      hasInvoice: false,
      changes: MOVED_DATE,
    }),
    null,
  );
});

test("reopening does not unlock an invoiced job", () => {
  // The invoice already told the customer which day the work happened, so a
  // status change must not become a way around the billing lock.
  assert.equal(
    scheduleChangeLock({
      currentStatus: "completed",
      requestedStatus: "scheduled",
      hasInvoice: true,
      changes: MOVED_DATE,
    }),
    "invoiced",
  );
});

test("marking complete in the same request that moves the job is refused", () => {
  assert.equal(
    scheduleChangeLock({
      currentStatus: "scheduled",
      requestedStatus: "completed",
      hasInvoice: false,
      changes: MOVED_DATE,
    }),
    "completed",
  );
});

test("status matching is not fooled by case or padding", () => {
  for (const status of ["Completed", " COMPLETED ", "completed"]) {
    assert.equal(
      scheduleChangeLock({ currentStatus: status, hasInvoice: false, changes: MOVED_DATE }),
      "completed",
      `${JSON.stringify(status)} must be treated as completed`,
    );
  }
});

test("a non-string status is not mistaken for completed", () => {
  assert.equal(
    scheduleChangeLock({ currentStatus: null, hasInvoice: false, changes: MOVED_DATE }),
    null,
  );
  assert.equal(
    scheduleChangeLock({ currentStatus: undefined, hasInvoice: false, changes: MOVED_DATE }),
    null,
  );
});

test("each refusal explains the way forward", () => {
  assert.match(scheduleLockMessage("completed"), /Reopen the job/);
  assert.match(scheduleLockMessage("invoiced"), /Void or credit the invoice/);
});
