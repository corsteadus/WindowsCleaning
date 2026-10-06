import assert from "node:assert/strict";
import test from "node:test";
import { addressLine, jobDrawerSummary, type JobDetailLike } from "./job-drawer.ts";

const occurrence = {
  id: 57,
  jobNumber: "J-57",
  status: "scheduled",
  scheduledDate: "2026-11-10",
  startTime: "09:00",
  endTime: "11:00",
  serviceType: "Window cleaning",
  isRecurring: false,
  crewId: 1,
  crewName: "Alpha",
  customerLabel: "Acme Holdings",
  clientType: "commercial",
  propertyLabel: "Main office",
  amountCents: 15000,
  invoiceStatus: "sent",
} as Parameters<typeof jobDrawerSummary>[0];

test("the drawer opens with the card's own answer, before anything is fetched", () => {
  const summary = jobDrawerSummary(occurrence);
  assert.equal(summary.loadingDetail, true, "the detail is still coming");
  assert.equal(summary.customerName, "Acme Holdings");
  assert.equal(summary.when, "Tue, Nov 10, 2026");
  assert.equal(summary.time, "9:00 AM – 11:00 AM");
  assert.equal(summary.where, "Main office");
  assert.equal(summary.who, "Alpha");
  assert.equal(summary.amountCents, 15000);
  assert.equal(summary.invoiceStatus, "sent");
});

test("the full job fills in what the card could not carry", () => {
  const detail: JobDetailLike = {
    notes: "Ladder from the alley.",
    customer: { id: 9, firstName: "Ada", lastName: "Lovelace", cellPhone: "(816) 555-1234" },
    property: { name: "Main office", address: "4820 E Camelback Rd", city: "Scottsdale", state: "AZ", zip: "85251" },
    assignedTechnician: { firstName: "Tom", lastName: "Tech" },
  };
  const summary = jobDrawerSummary(occurrence, detail);
  assert.equal(summary.loadingDetail, false);
  assert.equal(summary.customerName, "Ada Lovelace");
  assert.equal(summary.customerId, 9);
  assert.equal(summary.customerPhone, "(816) 555-1234");
  assert.equal(summary.notes, "Ladder from the alley.");
  assert.equal(summary.where, "Main office · 4820 E Camelback Rd · Scottsdale, AZ, 85251");
  assert.equal(summary.who, "Alpha · Tom Tech");
});

test("the detail wins only where it has an answer", () => {
  // A half-filled job must not blank out what the card already showed.
  const summary = jobDrawerSummary(occurrence, { notes: "" });
  assert.equal(summary.customerName, "Acme Holdings");
  assert.equal(summary.where, "Main office");
  assert.equal(summary.who, "Alpha");
  assert.equal(summary.time, "9:00 AM – 11:00 AM");
  assert.equal(summary.notes, null, "an empty note is no note");
});

test("a company name is the customer's name when there is one", () => {
  const summary = jobDrawerSummary(occurrence, {
    customer: { id: 4, firstName: "Ada", lastName: "Lovelace", companyName: "Acme Holdings Ltd" },
  });
  assert.equal(summary.customerName, "Acme Holdings Ltd");
});

test("times are read the way Kyle asked, and a missing one says so", () => {
  assert.equal(jobDrawerSummary({ ...occurrence, startTime: "13:30", endTime: null }).time, "1:30 PM");
  assert.equal(jobDrawerSummary({ ...occurrence, startTime: null, endTime: null }).time, "No time set");
  assert.doesNotMatch(jobDrawerSummary(occurrence).time, /am|pm/, "standard AM / PM");
});

test("an unassigned job says so rather than showing an empty line", () => {
  const summary = jobDrawerSummary({ ...occurrence, crewId: null, crewName: null });
  assert.equal(summary.who, "Nobody assigned yet");
});

test("money a viewer may not see stays unseen", () => {
  // The occurrence carries null for a field technician; a total arriving on the
  // detail must not reveal it.
  const summary = jobDrawerSummary({ ...occurrence, amountCents: null }, { totalAmount: 150 });
  assert.equal(summary.amountCents, null);
});

test("the detail's total replaces the card's when both are allowed", () => {
  assert.equal(jobDrawerSummary(occurrence, { totalAmount: "175.50" }).amountCents, 17550);
  assert.equal(jobDrawerSummary(occurrence, { totalAmount: null }).amountCents, 15000, "null is not zero");
});

test("a date that is not a date says so", () => {
  assert.equal(jobDrawerSummary({ ...occurrence, scheduledDate: "" as never }).when, "No date");
});

test("an address is built from the parts that exist", () => {
  assert.equal(addressLine(null), null);
  assert.equal(addressLine({}), null);
  assert.equal(addressLine({ address: "1 Main" }), "1 Main");
  assert.equal(addressLine({ name: "1 Main", address: "1 Main" }), "1 Main", "a name equal to the street is not repeated");
  assert.equal(addressLine({ name: "Guest house", address: "1 Main", city: "Austin", state: "TX" }),
    "Guest house · 1 Main · Austin, TX");
});
