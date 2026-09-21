import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  prepareQuoteAppointment,
  submittedQuoteAppointment,
  type QuoteAppointmentDraft,
} from "./quote-appointment-submission.ts";

const TECH = "b8a5a727-d76a-4a7b-88c6-bc7e23400b24";

function draft(overrides: Partial<QuoteAppointmentDraft> = {}): QuoteAppointmentDraft {
  return {
    date: "2026-10-14",
    time: "09:00",
    duration: "60",
    durationTouched: false,
    assignedUserId: TECH,
    propertyIds: [],
    fallbackPropertyId: 10,
    availablePropertyIds: [10],
    selectableTechnicianIds: [TECH],
    appointmentNotes: "",
    estimateNotes: "",
    ...overrides,
  };
}

test("an appointment with no ticked location falls back to the selected property", () => {
  const prepared = prepareQuoteAppointment(draft());
  assert.equal(prepared.kind, "ready");
  if (prepared.kind !== "ready") return;
  assert.deepEqual(prepared.request.propertyIds, [10]);
});

test("without a selected property or a ticked location, the location is what's named", () => {
  const prepared = prepareQuoteAppointment(draft({ fallbackPropertyId: null }));
  assert.equal(prepared.kind, "invalid");
  if (prepared.kind !== "invalid") return;
  assert.match(prepared.message, /needs a customer location\./);
  assert.doesNotMatch(prepared.message, /date/);
});

test("only the fields that are actually wrong are named", () => {
  const prepared = prepareQuoteAppointment(draft({ date: "", assignedUserId: "unassigned" }));
  assert.equal(prepared.kind, "invalid");
  if (prepared.kind !== "invalid") return;
  assert.match(prepared.message, /a valid date and start time/);
  assert.match(prepared.message, /an active Field or Team Technician/);
  assert.doesNotMatch(prepared.message, /duration/);
  assert.doesNotMatch(prepared.message, /customer location/);
});

test("an untouched, empty appointment is blank rather than invalid", () => {
  const prepared = prepareQuoteAppointment(draft({
    date: "", time: "", assignedUserId: "unassigned", fallbackPropertyId: null,
  }));
  assert.equal(prepared.kind, "blank");
});

test("the submitted fallback property comes from the form field", () => {
  const form = new FormData();
  form.set("appointmentDate", "2026-10-14");
  form.set("appointmentTime", "09:00");
  form.set("appointmentDuration", "60");
  form.set("assignedUserId", TECH);
  form.set("appointmentFallbackPropertyId", "10");
  const submitted = submittedQuoteAppointment(form, draft({ fallbackPropertyId: null }));
  assert.equal(submitted.fallbackPropertyId, 10);
  assert.equal(prepareQuoteAppointment(submitted).kind, "ready");
});

// The bug this guards: appointmentFallbackPropertyId used to be a hidden input
// written imperatively through a ref, so a remount reset it to "" and every
// scheduled estimate failed validation with no way to tell why.
test("QuoteNew binds the hidden appointment fields to state, not to a ref", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../pages/QuoteNew.tsx", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /appointmentFallbackPropertyControlRef/);
  assert.doesNotMatch(source, /appointmentDurationTouchedControlRef/);
  assert.match(source, /name="appointmentFallbackPropertyId" value=\{propertyId\}/);
  assert.match(source, /name="appointmentDurationTouched" value=\{String\(appointmentDurationTouched\)\}/);
});
