import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_CALENDAR_FILTERS,
  UNASSIGNED,
  assignmentKey,
  assignmentOptions,
  filterOccurrences,
  isFiltering,
  matchesCalendarFilters,
  toggleAssignment,
  totalsFromOccurrences,
} from "./calendar-filters.ts";

type Occurrence = Parameters<typeof matchesCalendarFilters>[0];

const job = (over: Partial<Occurrence> = {}): Occurrence => ({
  id: 1,
  jobNumber: "J-1",
  status: "scheduled",
  scheduledDate: "2026-11-10",
  startTime: "09:00",
  endTime: "11:00",
  serviceType: "Windows",
  isRecurring: false,
  crewId: 1,
  crewName: "Alpha",
  customerLabel: "A Customer",
  clientType: "residential",
  propertyLabel: null,
  amountCents: 15000,
  invoiceStatus: null,
  ...over,
} as Occurrence);

test("a calendar with no filters hides nothing", () => {
  assert.deepEqual(NO_CALENDAR_FILTERS.selectedAssignments, []);
  assert.equal(NO_CALENDAR_FILTERS.showCompletedJobs, true);
  assert.equal(isFiltering(NO_CALENDAR_FILTERS), false);
  const jobs = [job(), job({ id: 2, crewId: null, crewName: null }), job({ id: 3, status: "completed" })];
  assert.equal(filterOccurrences(jobs, NO_CALENDAR_FILTERS).length, 3);
});

test("a card belongs to a crew, or to nobody", () => {
  assert.equal(assignmentKey(job({ crewId: 4 })), "crew-4");
  assert.equal(assignmentKey(job({ crewId: null })), UNASSIGNED);
  assert.equal(assignmentKey(job({ crewId: undefined as never })), UNASSIGNED);
});

test("only the assignments actually booked this month are offered", () => {
  const options = assignmentOptions([
    job({ crewId: 2, crewName: "Bravo" }),
    job({ crewId: 1, crewName: "Alpha" }),
    job({ crewId: 1, crewName: "Alpha" }),
    job({ crewId: null, crewName: null }),
  ]);
  assert.deepEqual(options.map((o) => `${o.label}:${o.count}`), ["Alpha:2", "Bravo:1", "Unassigned:1"]);
  assert.equal(options.at(-1)?.key, UNASSIGNED, "the leftovers read last");
});

test("a crew with no name still has a label", () => {
  const [option] = assignmentOptions([job({ crewId: 9, crewName: null })]);
  assert.equal(option.label, "Crew #9");
});

test("choosing an assignment shows only that one", () => {
  const jobs = [
    job({ id: 1, crewId: 1, crewName: "Alpha" }),
    job({ id: 2, crewId: 2, crewName: "Bravo" }),
    job({ id: 3, crewId: null, crewName: null }),
  ];
  const state = { ...NO_CALENDAR_FILTERS, selectedAssignments: ["crew-1"] };
  assert.deepEqual(filterOccurrences(jobs, state).map((o) => o.id), [1]);
  assert.equal(isFiltering(state), true);

  const two = { ...NO_CALENDAR_FILTERS, selectedAssignments: ["crew-2", UNASSIGNED] };
  assert.deepEqual(filterOccurrences(jobs, two).map((o) => o.id), [2, 3]);
});

test("completed work can be put away without hiding anything else", () => {
  const jobs = [job({ id: 1 }), job({ id: 2, status: "completed" }), job({ id: 3, status: "in_progress" })];
  const state = { ...NO_CALENDAR_FILTERS, showCompletedJobs: false };
  assert.deepEqual(filterOccurrences(jobs, state).map((o) => o.id), [1, 3]);
  assert.equal(isFiltering(state), true);
});

test("ticking an assignment on and off again leaves what it found", () => {
  const once = toggleAssignment(NO_CALENDAR_FILTERS, "crew-1");
  assert.deepEqual(once.selectedAssignments, ["crew-1"]);
  const twice = toggleAssignment(once, "crew-1");
  assert.deepEqual(twice.selectedAssignments, []);
  // …and the original is untouched.
  assert.deepEqual(NO_CALENDAR_FILTERS.selectedAssignments, []);
});

test("the day footer counts the cards that are actually shown", () => {
  // The fault this prevents: eleven jobs in the footer above a cell showing
  // three, because the server totalled the whole month and the grid filtered.
  const totals = totalsFromOccurrences([
    job({ id: 1, scheduledDate: "2026-11-10", amountCents: 15000, startTime: "09:00", endTime: "11:00" }),
    job({ id: 2, scheduledDate: "2026-11-10", amountCents: 5000, status: "completed", startTime: "13:00", endTime: "13:30" }),
    job({ id: 3, scheduledDate: "2026-11-11", amountCents: 2500, startTime: null, endTime: null }),
  ], { amountsHidden: false });

  assert.deepEqual(totals.get("2026-11-10"), {
    date: "2026-11-10", jobCount: 2, completedCount: 1, scheduledValueCents: 20000, durationMinutes: 150,
  });
  assert.deepEqual(totals.get("2026-11-11"), {
    date: "2026-11-11", jobCount: 1, completedCount: 0, scheduledValueCents: 2500, durationMinutes: 0,
  });
});

test("money stays hidden from somebody who may not see it", () => {
  const totals = totalsFromOccurrences([job({ amountCents: null })], { amountsHidden: true });
  assert.equal(totals.get("2026-11-10")?.scheduledValueCents, null, "null, not a confident zero");
});

test("a time that cannot be read adds no minutes", () => {
  const totals = totalsFromOccurrences([
    job({ startTime: "11:00", endTime: "09:00" }),
    job({ id: 2, startTime: "nonsense", endTime: "10:00" }),
  ], { amountsHidden: false });
  assert.equal(totals.get("2026-11-10")?.durationMinutes, 0);
});
