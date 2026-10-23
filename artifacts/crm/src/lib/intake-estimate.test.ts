import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BLANK_APPOINTMENT, appointmentIsBlank, buildEstimate, emailBlocker, estimateProblems, estimateTotal,
  type EstimateLineDraft,
} from "./intake-estimate.ts";

const line = (patch: Partial<EstimateLineDraft> = {}): EstimateLineDraft => ({
  key: "a", serviceId: 3, description: "Window cleaning", quantity: "1", unitPrice: "", location: 0, serviceNotes: "", ...patch,
});
const both = { main: true, locations: 1 };

describe("the estimate on the Add Prospect form — Kyle's Video 3", () => {
  // Kyle, 2026-10-24: blank is not priced and cannot be sent; $0.00 is a price.
  it("a blank price is sent as null, \"to be quoted\"; 0 is sent as 0", () => {
    const estimate = buildEstimate([line(), line({ key: "b", unitPrice: "0" })], BLANK_APPOINTMENT);
    assert.deepEqual(estimate.lines[0], {
      serviceId: 3, description: "Window cleaning", quantity: 1, unitPrice: null, location: 0, serviceNotes: null,
    });
    assert.equal(estimate.lines[1].unitPrice, 0);
    assert.equal(estimate.appointment, null);
  });

  it("an estimate with a $0 service can be emailed; one with a blank cannot", () => {
    assert.equal(emailBlocker([line({ unitPrice: "0" })], "a@b.co"), null);
    assert.match(emailBlocker([line({ unitPrice: "" })], "a@b.co")!, /price Window cleaning/);
  });

  it("each line keeps its location and its customer-visible description", () => {
    const [sent] = buildEstimate([line({ location: 1, serviceNotes: " Front and back " })], BLANK_APPOINTMENT).lines;
    assert.deepEqual([sent.location, sent.serviceNotes], [1, "Front and back"]);
  });

  it("an untouched appointment is no appointment; a touched one needs a time and an estimator", () => {
    assert.equal(appointmentIsBlank(BLANK_APPOINTMENT), true, "the default duration alone is not a booking");
    assert.deepEqual(estimateProblems([line()], { ...BLANK_APPOINTMENT, date: "2027-03-16" }, both),
      ["The estimate appointment still needs a date and start time and an estimator, or leave it all blank"]);
  });

  it("\"between 3 and 4\" is a start at 3 for an hour, in Chicago time", () => {
    const estimate = buildEstimate([line()], { date: "2027-03-16", time: "15:00", duration: "60", assignedUserId: "u1", appointmentNotes: "" });
    assert.equal(estimate.appointment?.durationMinutes, 60);
    assert.match(String(estimate.appointment?.startsAt), /^2027-03-16T(20|21):00:00(\.000)?(Z|-0[56]:00)$/);
  });

  it("says what is wrong before anything is sent", () => {
    assert.deepEqual(estimateProblems([line({ description: "" })], BLANK_APPOINTMENT, both),
      ["Add at least one service to the estimate, or untick it"]);
    assert.deepEqual(estimateProblems([line({ location: 0 })], BLANK_APPOINTMENT, { main: false, locations: 0 }),
      ["Window cleaning: fill in the service address first"]);
    assert.deepEqual(estimateProblems([line({ quantity: "0" })], BLANK_APPOINTMENT, both),
      ["Window cleaning: quantity must be more than 0"]);
  });

  it("Save and email is offered only when every service is priced and there is an address", () => {
    assert.match(emailBlocker([line(), line({ key: "b", description: "Gutters", unitPrice: "120" })], "a@b.co")!, /price Window cleaning/);
    assert.equal(emailBlocker([line({ unitPrice: "250" })], ""), "Add an email address to send it to");
    assert.equal(emailBlocker([line({ unitPrice: "250" })], "a@b.co"), null);
  });

  it("the running total counts the priced lines", () => {
    assert.equal(estimateTotal([line({ unitPrice: "250", quantity: "2" }), line({ key: "b" })]), 500);
  });
});
