import assert from "node:assert/strict";
import test from "node:test";
import { redactAssignedJob } from "./field-tech-scope.ts";

test("assigned job serialization removes commercial fields but preserves field workflow data", () => {
  const safe = redactAssignedJob({
    id: 1,
    status: "completed",
    totalAmount: 425,
    quoteId: 9,
    notes: "Use side gate",
    techNotes: "Finished",
    lineItems: JSON.stringify([{
      name: "Exterior windows",
      assignedUserIds: ["tech-a"],
      unitPrice: 425,
      totalPrice: 425,
    }]),
  });
  assert.equal("totalAmount" in safe, false);
  assert.equal("quoteId" in safe, false);
  assert.equal(safe.status, "completed");
  assert.equal(safe.notes, "Use side gate");
  assert.equal(safe.techNotes, "Finished");
  const [line] = JSON.parse(String(safe.lineItems));
  assert.deepEqual(line.assignedUserIds, ["tech-a"]);
  assert.equal("unitPrice" in line, false);
  assert.equal("totalPrice" in line, false);
});

test("a second technician's assignment is not mistaken for the current technician", () => {
  const lineItems = [
    { name: "Assigned work", assignedUserIds: ["tech-a"] },
    { name: "Second tech work", assignedUserIds: ["tech-b"] },
  ];
  const assignedTo = (userId: string) =>
    lineItems.some((line) => line.assignedUserIds.includes(userId));
  assert.equal(assignedTo("tech-a"), true);
  assert.equal(assignedTo("tech-b"), true);
  assert.equal(assignedTo("unassigned-tech"), false);
});