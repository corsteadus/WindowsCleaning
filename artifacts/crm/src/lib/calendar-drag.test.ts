import test from "node:test";
import assert from "node:assert/strict";
import {
  UNDO_WINDOW_MS,
  canDrag,
  dragBlockMessage,
  dragBlockReason,
  resolveMonthDrop,
  type DraggableOccurrence,
} from "./calendar-drag.ts";

const job = (over: Partial<DraggableOccurrence> = {}): DraggableOccurrence => ({
  id: 1,
  status: "scheduled",
  scheduledDate: "2026-09-14",
  invoiceStatus: null,
  ...over,
});

test("scheduled and in-progress work can be dragged", () => {
  assert.equal(canDrag(job()), true);
  assert.equal(canDrag(job({ status: "in_progress" })), true);
});

test("completed work cannot be dragged", () => {
  assert.equal(dragBlockReason(job({ status: "completed" })), "completed");
});

test("canceled work cannot be dragged", () => {
  assert.equal(dragBlockReason(job({ status: "canceled" })), "canceled");
});

test("an invoiced job cannot be dragged even while still scheduled", () => {
  for (const invoiceStatus of ["sent", "paid", "overdue", "partially_paid", "draft"]) {
    assert.equal(
      dragBlockReason(job({ invoiceStatus })),
      "invoiced",
      `${invoiceStatus} must pin the job`,
    );
  }
});

test("a voided invoice releases the job", () => {
  // Voiding withdraws the document that cited the service date, so the work
  // is schedulable again.
  assert.equal(dragBlockReason(job({ invoiceStatus: "voided" })), null);
  assert.equal(dragBlockReason(job({ invoiceStatus: " VOIDED " })), null);
});

test("status matching is not fooled by case or padding", () => {
  assert.equal(dragBlockReason(job({ status: " Completed " })), "completed");
  assert.equal(dragBlockReason(job({ status: "CANCELED" })), "canceled");
});

test("completion outranks billing when reporting why", () => {
  // Both apply; the message should name the one the user can act on first.
  assert.equal(
    dragBlockReason(job({ status: "completed", invoiceStatus: "sent" })),
    "completed",
  );
});

test("a month drop moves the day and says which", () => {
  const result = resolveMonthDrop(job(), "2026-09-21");
  assert.deepEqual(result, {
    kind: "move",
    jobId: 1,
    from: "2026-09-14",
    to: "2026-09-21",
  });
});

test("a month drop never carries a time", () => {
  // The patch is built from this result; a time here would silently move the
  // crew's morning. Only the date may appear.
  const result = resolveMonthDrop(job(), "2026-09-21");
  assert.deepEqual(Object.keys(result).sort(), ["from", "jobId", "kind", "to"]);
});

test("dropping a job back on its own day changes nothing", () => {
  assert.deepEqual(resolveMonthDrop(job(), "2026-09-14"), { kind: "unchanged" });
});

test("a blocked job reports the block rather than a move", () => {
  assert.deepEqual(resolveMonthDrop(job({ status: "completed" }), "2026-09-21"), {
    kind: "blocked",
    reason: "completed",
  });
  assert.deepEqual(resolveMonthDrop(job({ invoiceStatus: "paid" }), "2026-09-21"), {
    kind: "blocked",
    reason: "invoiced",
  });
});

test("a blocked job is blocked even when dropped on its own day", () => {
  assert.equal(
    resolveMonthDrop(job({ status: "completed" }), "2026-09-14").kind,
    "blocked",
  );
});

test("every block reason explains the way forward", () => {
  assert.match(dragBlockMessage("completed"), /Reopen the job/);
  assert.match(dragBlockMessage("invoiced"), /Void or credit/);
  assert.match(dragBlockMessage("canceled"), /Canceled/);
});

test("the undo window sits inside the spec's 10-20 seconds", () => {
  assert.ok(UNDO_WINDOW_MS >= 10_000 && UNDO_WINDOW_MS <= 20_000);
});
