import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("accepted estimate revision UI", () => {
  it("offers revision creation and hides edit controls while accepted", async () => {
    const source = await readFile(new URL("./QuoteDetail.tsx", import.meta.url), "utf8");
    assert.match(source, /Create revision/);
    assert.match(source, /\/revisions/);
    assert.match(source, /\{!acceptedLocked && <button[\s\S]*?onClick=\{startEdit\}/);
    assert.match(source, /quote\.status === "accepted" \|\| quote\.status === "approved"/);
  });

  it("shows conversion assignments on scheduled calendar cards", async () => {
    const source = await readFile(new URL("./Schedule.tsx", import.meta.url), "utf8");
    const scheduledCard = source.slice(source.indexOf("function ScheduleJobCard"));
    assert.match(scheduledCard, /crewName/);
    assert.match(scheduledCard, /assignedEmployeeNames/);
  });

  it("offers conversion for finalized estimates before customer acceptance", async () => {
    const source = await readFile(new URL("./QuoteDetail.tsx", import.meta.url), "utf8");
    assert.match(source, /data\?\.revision && status !== "accepted_scheduled"/);
    assert.match(source, /EstimateConversionDialog/);
  });
});