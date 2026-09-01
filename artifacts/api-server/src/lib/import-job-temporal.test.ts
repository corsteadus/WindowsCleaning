import assert from "node:assert/strict";
import test from "node:test";
import {
  validateImportJobBatch,
  validateImportJobTemporalValues,
  writeValidatedImportedJob,
} from "./import-job-temporal.ts";

test("preserves null and exact date/time strings", () => {
  assert.deepEqual(validateImportJobTemporalValues({
    scheduledDate: "2028-02-29",
    scheduledStartTime: "09:05",
    scheduledEndTime: null,
  }), {
    scheduledDate: "2028-02-29",
    scheduledStartTime: "09:05",
    scheduledEndTime: null,
  });
});

test("rejects malformed and rollover values with zero writes", async () => {
  for (const values of [
    { scheduledDate: "2026-02-29" },
    { scheduledDate: "2026-04-31" },
    { scheduledDate: " 2026-04-30" },
    { scheduledStartTime: "24:00" },
    { scheduledEndTime: "10:61" },
  ]) {
    let writes = 0;
    await assert.rejects(() => writeValidatedImportedJob(values, async () => {
      writes++;
    }));
    assert.equal(writes, 0);
  }
});

test("a bad row rejects the complete admin-style batch before writes", () => {
  let writes = 0;
  assert.throws(() => {
    const rows = validateImportJobBatch([
      { scheduledDate: "2026-01-01" },
      { scheduledDate: "2026-01-32" },
    ]);
    for (const _row of rows) writes++;
  });
  assert.equal(writes, 0);
});