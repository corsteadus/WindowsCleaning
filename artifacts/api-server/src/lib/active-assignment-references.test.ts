import assert from "node:assert/strict";
import test from "node:test";
import { validateAndLockActiveAssignmentReferences } from "./active-assignment-references.ts";

test("invalid or deactivated assignment references stop before writes", async () => {
  for (const testCase of [
    { crewIds: [0], directUserIds: [] },
    { crewIds: [7], directUserIds: [] },
    { crewIds: [], directUserIds: ["inactive-tech"] },
  ]) {
    const order: string[] = [];
    await assert.rejects(async () => {
      await validateAndLockActiveAssignmentReferences(testCase, {
        lockActiveCrews: async () => { order.push("lock-crews"); return []; },
        lockActiveFieldTechUsers: async () => { order.push("lock-users"); return []; },
      });
      order.push("insert-job");
    });
    assert.equal(order.includes("insert-job"), false);
  }
});

test("active references are locked before the caller can insert", async () => {
  const order: string[] = [];
  await validateAndLockActiveAssignmentReferences({
    crewIds: [7],
    directUserIds: ["tech-1"],
  }, {
    lockActiveCrews: async (ids) => { order.push("lock-crews"); return ids; },
    lockActiveFieldTechUsers: async (ids) => { order.push("lock-users"); return ids; },
  });
  order.push("insert-job");
  assert.deepEqual(order, ["lock-crews", "lock-users", "insert-job"]);
});