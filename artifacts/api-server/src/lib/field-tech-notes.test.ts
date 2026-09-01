import assert from "node:assert/strict";
import test from "node:test";
import { isAppendOnlyJobNotesRole, requiredCapabilityForJobMutation } from "./authorization.ts";
import { appendFieldTechNote } from "./field-tech-notes.ts";

test("field technician notes append to the existing record instead of replacing it", () => {
  assert.equal(appendFieldTechNote("Office dispatch note", "  Tech completed the gate check  "), "Office dispatch note\nTech completed the gate check");
  assert.equal(appendFieldTechNote(null, "On site"), "On site");
  const afterOneAddition = appendFieldTechNote("Existing job history", "One new addition");
  assert.equal(afterOneAddition, "Existing job history\nOne new addition");
  // A reset client sends no second field, so the server never receives history
  // as a second append payload.
  assert.equal(afterOneAddition.includes("One new addition\nOne new addition"), false);
});

test("legacy employee uses the same append policy and preserves prior history", () => {
  assert.equal(isAppendOnlyJobNotesRole("employee"), true);
  assert.equal(
    appendFieldTechNote("Office history", "Employee arrival note"),
    "Office history\nEmployee arrival note",
  );
});

test("blank field technician note patches are denied before a route transaction can start", () => {
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/17", { notes: "" }), "schedule.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/17", { techNotes: "   " }), "schedule.manage");
  assert.equal(requiredCapabilityForJobMutation("PATCH", "/jobs/17", { notes: "Arrived" }), "jobs.manage");
  assert.throws(() => appendFieldTechNote("Existing", " "), /must contain text/);
});