import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobNotesPayload,
  hasJobNotesChanges,
  isAppendOnlyJobNotes,
} from "./job-notes-editing.ts";

test("field capability envelope sends only a single new note addition", () => {
  const appendOnly = isAppendOnlyJobNotes({ capabilities: ["jobs.manage"] });
  assert.equal(appendOnly, true);
  const payload = buildJobNotesPayload({
    appendOnly, existingNotes: "Office history", existingTechNotes: "Prior crew note",
    notesDraft: "Arrived on site", techNotesDraft: null,
  });
  assert.deepEqual(payload, { notes: "Arrived on site" });
  assert.equal(hasJobNotesChanges(appendOnly, null, null, "Office history", "Prior crew note"), false);
});

test("actual legacy employee and team-tech capability envelopes are append-only", () => {
  const employeeEnvelope = {
    capabilities: [
      "dashboard.view", "customers.view", "contacts.view", "properties.view",
      "jobs.view", "jobs.manage", "quotes.view", "estimates.schedule",
      "estimates.finalize", "schedule.view", "tasks.view", "tasks.manage",
    ],
  };
  const teamTechEnvelope = { capabilities: ["customers.view", "jobs.view", "jobs.manage", "schedule.view"] };
  assert.equal(isAppendOnlyJobNotes(employeeEnvelope), true);
  assert.equal(isAppendOnlyJobNotes(teamTechEnvelope), true);
});

test("field save reset prevents repeated historical-note appends", () => {
  const first = buildJobNotesPayload({
    appendOnly: true, existingNotes: "Office history", existingTechNotes: "",
    notesDraft: "Arrived", techNotesDraft: null,
  });
  assert.deepEqual(first, { notes: "Arrived" });
  const afterSuccessReset = buildJobNotesPayload({
    appendOnly: true, existingNotes: "Office history\nArrived", existingTechNotes: "",
    notesDraft: null, techNotesDraft: null,
  });
  assert.deepEqual(afterSuccessReset, {});
});

test("office/admin schedule capability retains replacement payload semantics", () => {
  const appendOnly = isAppendOnlyJobNotes({ capabilities: ["jobs.manage", "schedule.manage"] });
  assert.equal(appendOnly, false);
  assert.deepEqual(buildJobNotesPayload({
    appendOnly, existingNotes: "Old", existingTechNotes: "Crew old",
    notesDraft: "Office replacement", techNotesDraft: null,
  }), { notes: "Office replacement", techNotes: "Crew old" });
});