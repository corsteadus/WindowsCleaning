import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalCommunicationPayload,
  communicationPayloadHash,
  communicationEventStatusFromDeliveryStatuses,
  communicationRetryDelaySeconds,
  eventAutomationTrigger,
  safeCommunicationPayloadSummary,
  stableCommunicationValue,
} from "./communication-event-core.ts";

test("communication payload canonicalization is deterministic", () => {
  const first = { b: 2, nested: { z: true, a: 1 }, a: 1 };
  const second = { a: 1, nested: { a: 1, z: true }, b: 2 };
  assert.equal(canonicalCommunicationPayload(first), canonicalCommunicationPayload(second));
  assert.equal(communicationPayloadHash(first), communicationPayloadHash(second));
  assert.deepEqual(stableCommunicationValue({ when: new Date("2026-08-15T12:00:00.000Z") }), {
    when: "2026-08-15T12:00:00.000Z",
  });
});

test("safe summaries retain only operational identifiers and scalar values", () => {
  assert.deepEqual(
    safeCommunicationPayloadSummary({
      customerId: 7,
      paymentId: 11,
      amount: "12.34",
      privateNote: "must not appear",
      nested: { secret: "redacted" },
    }),
    { customerId: 7, paymentId: 11, amount: "12.34" },
  );
});

test("automation triggers use the legacy rule naming convention", () => {
  assert.equal(eventAutomationTrigger("payment.received"), "payment_received");
  assert.equal(eventAutomationTrigger("appointment.changed"), "appointment_changed");
});

test("retry delays are bounded exponential backoff", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 10].map(communicationRetryDelaySeconds),
    [5, 10, 20, 40, 80, 900],
  );
});

test("a retrying delivery keeps a mixed event retryable until all work is terminal", () => {
  assert.equal(
    communicationEventStatusFromDeliveryStatuses(["dead_letter", "retrying"]),
    "retrying",
  );
  assert.equal(
    communicationEventStatusFromDeliveryStatuses(["dead_letter", "succeeded"]),
    "dead_letter",
  );
  assert.equal(
    communicationEventStatusFromDeliveryStatuses(["succeeded", "succeeded"]),
    "succeeded",
  );
});