import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  liveDateControlValue,
  submittedJobSchedule,
  submittedJobScheduledDate,
} from "../lib/job-new-scheduled-date.ts";
import { committedScheduledDateMatches } from "../lib/job-date-commit.ts";

const jobNewSource = readFileSync(new URL("./JobNew.tsx", import.meta.url), "utf8");
const generatedApiSource = readFileSync(
  new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url),
  "utf8",
);

test("JobNew submits the exact visible date control value through the generated client", async () => {
  const dateInput = {
    type: "date",
    value: "2026-08-30",
  };
  const form = {
    elements: {
      namedItem: (name: string) => name === "scheduledDate" ? dateInput : null,
    },
  };

  // Reproduce the live mismatch: the controlled state still has Aug 29 while
  // the browser date control visibly contains Aug 30.
  const scheduledDate = submittedJobScheduledDate(form, "2026-08-29");
  assert.equal(scheduledDate, "2026-08-30");

  assert.match(
    generatedApiSource,
    /export const createJob = async[\s\S]*method: "POST"[\s\S]*body: JSON\.stringify\(createJobBody\)/,
  );
  const request = new Request("https://example.invalid/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerId: 1,
      scheduledDate,
      notes: "DISPOSABLE QA FUTURE DATE TEST",
    }),
  });
  const submittedBody = await request.json() as {
    scheduledDate?: string;
    notes?: string;
  };
  assert.equal(submittedBody.scheduledDate, "2026-08-30");
  assert.equal(submittedBody.notes, "DISPOSABLE QA FUTURE DATE TEST");

  assert.match(jobNewSource, /type="date"\s+name="scheduledDate"\s+value=\{scheduledDate\}/);
  assert.match(jobNewSource, /submittedJobSchedule\(e\.currentTarget/);
  assert.match(jobNewSource, /scheduledDate:\s+submittedSchedule\.date \|\| null/);
  assert.deepEqual(
    submittedJobSchedule(
      { elements: { namedItem: (name) => name === "scheduledDate" ? dateInput : null } },
      { date: "2026-08-29", startTime: "09:00", endTime: "10:00" },
    ),
    { date: "2026-08-30", startTime: "09:00", endTime: "10:00" },
  );
});

test("JobNew falls back to controlled state only when the named date control is unavailable", () => {
  const form = { elements: { namedItem: () => null } };
  assert.equal(submittedJobScheduledDate(form, "2026-08-30"), "2026-08-30");
});

test("JobDetail edit reads the live date and accepts success only for the committed date", () => {
  assert.equal(
    liveDateControlValue({ type: "date", value: "2026-08-30" }, "2026-08-29"),
    "2026-08-30",
  );
  assert.equal(committedScheduledDateMatches("2026-08-30", "2026-08-30"), true);
  assert.equal(committedScheduledDateMatches("2026-08-30", "2026-08-29"), false);
});