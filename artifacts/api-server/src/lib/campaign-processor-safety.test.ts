import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const source = fs.readFileSync(new URL("./campaign-processor.ts", import.meta.url), "utf8");

test("campaign processing evaluates safety in the same transaction before creating a provider log", () => {
  const gate = source.indexOf("const gate = await db.transaction");
  const eligibility = source.indexOf("evaluateRecipientEligibility", gate);
  const emailLogInsert = source.indexOf(".insert(emailLogsTable)", gate);
  const providerSend = source.indexOf("sendEmailTo(", gate);
  assert.ok(gate >= 0);
  assert.ok(eligibility > gate);
  assert.ok(emailLogInsert > eligibility);
  assert.ok(providerSend > emailLogInsert);
});

test("blocked and quiet-hour recipients have durable non-send states", () => {
  assert.match(source, /status: "skipped"/);
  assert.match(source, /safetyReasonCode: eligibility\.reasonCode/);
  assert.match(source, /status: "queued"/);
  assert.match(source, /nextAttemptAt: eligibility\.allowedAt/);
  assert.match(source, /status: "sending"/);
  assert.match(source, /status, "sending"/);
  assert.match(source, /Recovered after campaign processor restart/);
});

test("campaign retry selection excludes deferred recipients until their timestamp", () => {
  const queuedFilter = source.indexOf('eq(emailCampaignRecipientsTable.status, "queued")');
  const nextAttemptGuard = source.indexOf("isNull(emailCampaignRecipientsTable.nextAttemptAt)", queuedFilter);
  assert.ok(queuedFilter >= 0);
  assert.ok(nextAttemptGuard > queuedFilter);
  assert.match(source, /classification: campaign\.classification as MessageClassification/);
});