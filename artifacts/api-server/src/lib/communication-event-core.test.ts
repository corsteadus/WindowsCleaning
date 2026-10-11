import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalCommunicationPayload,
  communicationPayloadHash,
  communicationEventStatusFromDeliveryStatuses,
  communicationRetryDelaySeconds,
  eventAutomationTrigger,
  interpolateTemplate,
  safeCommunicationPayloadSummary,
  stableCommunicationValue,
} from "./communication-event-core.ts";

// A placeholder with no value used to be left standing. Harmless while the
// provider was a mock that logged; a customer-facing defect the day Gmail was
// connected (2026-10-10).
test("a placeholder with no value is removed, never shown to a customer", () => {
  assert.equal(
    interpolateTemplate("Your invoice {{invoiceNumber}} for {{amount}} is ready.", {
      invoiceNumber: "INV-1042",
    }),
    "Your invoice INV-1042 for is ready.",
  );
  // The one that matters most: `invoices` has no `amount` column — it has
  // `totalAmount` — so this is the realistic mistake.
  assert.doesNotMatch(
    interpolateTemplate("Total: {{amount}}", {}),
    /\{\{/,
  );
  assert.equal(interpolateTemplate("Hello {{customerName}},", { customerName: null }), "Hello,");
  assert.equal(interpolateTemplate("Due {{dueDate}}.", { dueDate: undefined }), "Due.");
});

test("a filled placeholder is filled, including a number and a zero", () => {
  assert.equal(interpolateTemplate("{{a}} and {{b}}", { a: "x", b: "y" }), "x and y");
  assert.equal(interpolateTemplate("{{n}}", { n: 0 }), "0");
  assert.equal(interpolateTemplate("{{n}}", { n: 12.5 }), "12.5");
  assert.equal(interpolateTemplate("no placeholders here", {}), "no placeholders here");
});

test("removing a placeholder does not leave the sentence looking broken", () => {
  assert.equal(interpolateTemplate("Paid on {{paymentDate}} .", {}), "Paid on.");
  assert.equal(interpolateTemplate("<p>{{x}}</p><p>Hi</p>", {}), "<p></p><p>Hi</p>");
});

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