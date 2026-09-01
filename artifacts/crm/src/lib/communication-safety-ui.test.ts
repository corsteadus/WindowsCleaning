import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const card = fs.readFileSync(new URL("../components/CommunicationSafetyCard.tsx", import.meta.url), "utf8");
const customerDetail = fs.readFileSync(new URL("../pages/CustomerDetail.tsx", import.meta.url), "utf8");
const leadDetail = fs.readFileSync(new URL("../pages/LeadDetail.tsx", import.meta.url), "utf8");
const communications = fs.readFileSync(new URL("../pages/Communications.tsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../pages/Settings.tsx", import.meta.url), "utf8");

test("customer communications mounts the safety card and preserves masked history", () => {
  assert.match(customerDetail, /<CommunicationSafetyCard customerId=\{customerId\} \/>/);
  assert.match(card, /No raw destinations in history/);
  assert.match(card, /destinationHash/);
  assert.match(card, /maskedDestination/);
  assert.doesNotMatch(card, /item\.destination\b/);
});

test("safety card gates visibility and sends idempotent consent mutations", () => {
  assert.match(card, /communication\.view/);
  assert.match(card, /communication\.manage/);
  assert.match(card, /Idempotency-Key/);
  assert.match(card, /invalidateQueries/);
  assert.match(card, /SMS disclosure or terms snapshot/);
  assert.match(card, /window\.confirm/);
  assert.match(card, /Could not update communication status/);
});

test("direct sends carry idempotency and bulk sends opt into marketing classification", () => {
  assert.match(customerDetail, /Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.match(leadDetail, /Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.match(communications, /classification: "marketing"/);
});

test("settings keeps quiet hours and suppression administration capability-gated", () => {
  assert.match(settings, /communication\.settings/);
  assert.match(settings, /enabled: canManage/);
  assert.match(settings, /communication-safety\/suppressions/);
  assert.match(settings, /Idempotency-Key/);
  assert.match(settings, /Deactivate this suppression/);
  assert.match(settings, /matching start\/end times are also treated as disabled/);
});