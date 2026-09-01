import assert from "node:assert/strict";
import { test } from "node:test";
import type { InsertActivityLog } from "@workspace/db";
import {
  buildRecoveryActivityLogPayload,
  RECOVERY_ACTIVITY_LOG_FLAG,
} from "./migration-recover-jobs-payload.ts";

test("recovery activity payload matches current activity_logs columns", () => {
  const payload = buildRecoveryActivityLogPayload({
    restored: 4,
    skipped: 2,
    errors: 1,
    uniqueJobs: 5,
    totalScanned: 9,
    beforeCount: 12,
  });

  // Compile-time contract: this is assignable to the current Drizzle insert
  // shape, which has note but no details/metadata field.
  const currentSchemaPayload: InsertActivityLog = payload;
  assert.equal(currentSchemaPayload.entityType, "system");
  assert.equal(currentSchemaPayload.entityId, 0);
  assert.equal(currentSchemaPayload.action, RECOVERY_ACTIVITY_LOG_FLAG);
  assert.equal(currentSchemaPayload.performedBy, "migration");

  assert.deepEqual(Object.keys(payload).sort(), [
    "action",
    "entityId",
    "entityType",
    "note",
    "performedBy",
  ]);
  assert.equal("details" in payload, false);
  assert.equal("metadata" in payload, false);
  assert.match(payload.note, /restored=4/);
  assert.match(payload.note, /skipped=2/);
  assert.match(payload.note, /errors=1/);
  assert.match(payload.note, /uniqueJobs=5/);
  assert.match(payload.note, /totalScanned=9/);
  assert.match(payload.note, /beforeCount=12/);
});