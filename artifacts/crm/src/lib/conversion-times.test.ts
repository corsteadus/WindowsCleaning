// A4 (Kyle, Video 7): scheduling by duration with an exact time or an arrival window; the services chosen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { addMinutes, arrivalSummary, DURATION_OPTIONS, minutesLabel, WINDOW_OPTIONS } from "./conversion-times.ts";
import { conversionBlockers } from "./conversion-readiness.ts";
import { describeEstimateActivity } from "./estimate-history.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the end is start plus duration, and nothing runs past midnight", () => {
  assert.equal(addMinutes("09:00", 90), "10:30");
  assert.equal(addMinutes("23:00", 60), null);
  assert.equal(minutesLabel(90), "1 hour 30 min");
  assert.equal(minutesLabel(45), "45 min");
});

test("what the customer will be told, in one line", () => {
  assert.equal(arrivalSummary("09:00", "window", 120, 90), "Arrive between 9:00 AM and 11:00 AM · about 1 hour 30 min of work");
  assert.equal(arrivalSummary("09:00", "exact", 120, 90), "Arrive at 9:00 AM · done about 10:30 AM");
});

test("every choice on the screen is one the server accepts", () => {
  // Server: duration 15–720 in 5-minute steps; window 30–480 in 15-minute steps.
  assert.ok(DURATION_OPTIONS.every((m) => m >= 15 && m <= 720 && m % 5 === 0));
  assert.ok(WINDOW_OPTIONS.every((m) => m >= 30 && m <= 480 && m % 15 === 0));
});

test("the button says why it is off: nothing ticked, or running past midnight", () => {
  const base = { locationCount: 1, requiresVerbalAcceptance: false, verbalRecorded: false, verbalNote: "" };
  assert.deepEqual(conversionBlockers({ ...base, rows: [], servicesTicked: 0 }), ["Tick at least one service to schedule."]);
  const late = conversionBlockers({ ...base, servicesTicked: 1, rows: [{ propertyId: 1, scheduledDate: "2026-11-10", scheduledStartTime: "23:00", scheduledEndTime: "23:59", runsPastMidnight: true }] });
  assert.match(late.join(" "), /1 location runs past midnight/);
});

test("the history says what the office changed and the invoice it made", () => {
  const line = describeEstimateActivity({ id: 1, occurredAt: "2026-10-29T10:00:00Z", activityType: "estimate_converted_and_scheduled", actorType: "staff",
    detail: { jobIds: [1, 2], addedLineItemIds: [3], removedLineItemIds: [2], invoiceNumber: "INV-9" } });
  assert.equal(line.detail, "2 jobs · 1 declined service added · 1 accepted service left out · invoice INV-9 created");
});

test("the dialog: services ticked from the customer's choice, arrival, duration, and Schedule + invoice", () => {
  const dialog = read("../components/EstimateConversionDialog.tsx");
  assert.match(dialog, /setChosen\(new Set\(data\.acceptedLineItemIds \?\? /);
  assert.match(dialog, /data-testid="conversion-line-declined">Declined by the customer/);
  assert.match(dialog, /lineItemIds: \[\.\.\.chosen\],/);
  assert.match(dialog, /durationMinutes: row\.durationMinutes,\n\s+arrivalWindowMinutes: row\.mode === "window" \? row\.windowMinutes : null,/);
  assert.match(dialog, /onClick=\{\(\) => commit\.mutate\(true\)\}>/);
  assert.match(dialog, /if \(result\.invoice\) navigate\(`\/invoices\/\$\{result\.invoice\.id\}`\)/);
  assert.doesNotMatch(dialog, /type=["']time["']/);
});

test("the job shows its arrival window, and the profile's Files list its invoices", () => {
  assert.match(read("../pages/JobDetail.tsx"), /data-testid="job-arrival-window"/);
  const files = read("../components/FilesTab.tsx");
  assert.match(files, /\{entityType === "customer" && <CorsteadDocuments customerId=\{entityId\} \/>\}/);
  assert.match(files, /href=\{`\$\{BASE\}\/api\/invoices\/\$\{invoice\.id\}\/pdf`\}/);
});
