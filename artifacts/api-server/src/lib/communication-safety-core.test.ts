import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideCommunicationEligibility,
  hashCommunicationDestination,
  nextAllowedCommunicationTime,
  normalizeCommunicationDestination,
  parseOptOutPhrase,
} from "./communication-safety-core.ts";

const email = normalizeCommunicationDestination("email", " Person@Example.com ");
const sms = normalizeCommunicationDestination("sms", "(312) 555-0100");
const requestedAt = new Date("2026-01-15T15:00:00.000Z");

test("normalizes destinations and hashes only the normalized value", () => {
  assert.equal(email.normalized, "person@example.com");
  assert.equal(sms.normalized, "+13125550100");
  assert.equal(email.hash, hashCommunicationDestination("person@example.com"));
  assert.throws(() => normalizeCommunicationDestination("email", "not-an-email"), /Invalid email/);
  assert.throws(() => normalizeCommunicationDestination("sms", "12345"), /Invalid phone/);
});

test("parses provider-independent opt-out phrases", () => {
  for (const phrase of ["STOP", " quit ", "END", "revoke", "OPT OUT", "cancel", "unsubscribe"]) {
    assert.equal(parseOptOutPhrase(phrase), true, phrase);
  }
  assert.equal(parseOptOutPhrase("STOP PLEASE"), false);
});

test("eligibility precedence blocks suppression, consent, and provider failures before quiet hours", () => {
  const quietHours = { timezone: "America/Chicago", email: { start: "09:00", end: "17:00" } };
  const base = { channel: "email" as const, normalizedDestination: email.normalized, classification: "marketing" as const, requestedAt, source: "test" };
  assert.equal(decideCommunicationEligibility(base, {
    preference: { emailMarketingStatus: "subscribed" },
    suppressions: [{ channel: "email", destinationHash: email.hash, reason: "complaint", scope: "global", active: true }],
    quietHours,
  }).reasonCode, "hard_suppression");
  assert.equal(decideCommunicationEligibility(base, { quietHours }).reasonCode, "marketing_consent_missing");
  assert.equal(decideCommunicationEligibility({ ...base, classification: "transactional" }, {
    preference: { emailMarketingStatus: "bounced" },
    quietHours,
  }).reasonCode, "email_bounced");
});

test("transactional email remains compatible while marketing email requires explicit subscription", () => {
  const transactional = decideCommunicationEligibility({
    channel: "email",
    normalizedDestination: email.normalized,
    classification: "transactional",
    requestedAt,
    source: "test",
  });
  assert.equal(transactional.outcome, "eligible");
  assert.equal(decideCommunicationEligibility({
    channel: "email",
    normalizedDestination: email.normalized,
    classification: "marketing",
    requestedAt,
    source: "test",
  }).reasonCode, "marketing_consent_missing");
});

test("SMS requires recorded consent and opt-out overrides re-consent", () => {
  const input = { channel: "sms" as const, normalizedDestination: sms.normalized, classification: "transactional" as const, requestedAt, source: "test" };
  assert.equal(decideCommunicationEligibility(input).reasonCode, "sms_consent_missing");
  assert.equal(decideCommunicationEligibility(input, { preference: { smsConsentStatus: "opted_in" } }).outcome, "eligible");
  assert.equal(decideCommunicationEligibility(input, { preference: { smsConsentStatus: "opted_out" } }).reasonCode, "sms_opted_out");
});

test("quiet hours defer without changing the decision to blocked", () => {
  const result = decideCommunicationEligibility({
    channel: "email",
    normalizedDestination: email.normalized,
    classification: "transactional",
    requestedAt: new Date("2026-01-15T22:00:00.000Z"),
    source: "test",
  }, {
    preference: { emailMarketingStatus: "subscribed" },
    quietHours: { timezone: "America/Chicago", email: { start: "16:00", end: "08:00" } },
  });
  assert.equal(result.outcome, "deferred");
  assert.equal(result.reasonCode, "quiet_hours");
  assert.ok(result.allowedAt instanceof Date);
});

test("quiet hours support outside windows, cross-midnight, and DST transitions", () => {
  const window = { timezone: "America/New_York", email: { start: "22:00", end: "07:00" } };
  assert.equal(nextAllowedCommunicationTime(new Date("2026-01-15T15:00:00.000Z"), "email", window), null);
  const next = nextAllowedCommunicationTime(new Date("2026-01-15T04:00:00.000Z"), "email", window);
  assert.equal(next?.toISOString(), "2026-01-15T12:00:00.000Z");
  const spring = nextAllowedCommunicationTime(new Date("2026-03-08T06:30:00.000Z"), "email", {
    timezone: "America/New_York",
    email: { start: "00:00", end: "04:00" },
  });
  assert.equal(spring?.toISOString(), "2026-03-08T08:00:00.000Z");
  const fall = nextAllowedCommunicationTime(new Date("2026-11-01T05:30:00.000Z"), "email", {
    timezone: "America/New_York",
    email: { start: "00:00", end: "02:00" },
  });
  assert.equal(fall?.toISOString(), "2026-11-01T07:00:00.000Z");
});

test("quiet-hour boundaries are start-inclusive/end-exclusive and equal endpoints disable", () => {
  const window = {
    timezone: "UTC",
    email: { start: "22:00", end: "06:00" },
  };
  assert.equal(
    nextAllowedCommunicationTime(new Date("2026-01-15T21:59:00.000Z"), "email", window),
    null,
  );
  assert.equal(
    nextAllowedCommunicationTime(new Date("2026-01-15T22:00:00.000Z"), "email", window)?.toISOString(),
    "2026-01-16T06:00:00.000Z",
  );
  assert.equal(
    nextAllowedCommunicationTime(new Date("2026-01-16T06:00:00.000Z"), "email", window),
    null,
  );
  assert.equal(
    nextAllowedCommunicationTime(
      new Date("2026-01-15T12:00:00.000Z"),
      "email",
      { timezone: "UTC", email: { start: "12:00", end: "12:00" } },
    ),
    null,
  );
  assert.throws(
    () => nextAllowedCommunicationTime(
      new Date("2026-01-15T12:00:00.000Z"),
      "email",
      { timezone: "Not/A_Timezone", email: { start: "12:00", end: "13:00" } },
    ),
    /Invalid time zone|Invalid timezone/,
  );
});