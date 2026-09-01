import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { leadNoteActivityValues, leadPatchValues } from "./lead-activity.ts";

test("lead PATCH never writes legacy notes and instead appends each supplied note as activity", () => {
  const patch = leadPatchValues({
    firstName: "Ada",
    notes: "First immutable note",
  });
  assert.deepEqual(patch, { firstName: "Ada" });
  assert.equal(Object.hasOwn(patch, "notes"), false);

  const activities = [
    leadNoteActivityValues(12, "First immutable note", "Office"),
    leadNoteActivityValues(12, "Second immutable note", "Office"),
  ];
  assert.equal(activities.length, 2);
  assert.notEqual(activities[0].note, activities[1].note);
  assert.ok(activities.every((activity) =>
    activity.entityType === "lead" && activity.entityId === 12 && activity.action === "note_added",
  ));

  // Assert the HTTP PATCH path uses the shared append path inside its
  // transaction, rather than accidentally reintroducing a direct notes write.
  const source = readFileSync(new URL("../routes/leads.ts", import.meta.url), "utf8");
  assert.match(source, /const updateData = leadPatchValues\(body\)/);
  assert.match(source, /await appendLeadNote\(tx, id, appendedNote,/);
  assert.doesNotMatch(source, /"status","notes",/);
});