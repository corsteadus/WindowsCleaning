// Kyle 2026-09-24 #4: an optional setting, a prompt on every schedule change,
// nothing automatic, and silence on a crew-only change.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const settings = read("./ScheduleNotificationSettings.tsx");
const prompt = read("./ScheduleNotificationPrompt.tsx");
const layout = read("./Layout.tsx");
const calendar = read("./MonthCalendar.tsx");
const jobDetail = read("../pages/JobDetail.tsx");
const schedule = read("../pages/Schedule.tsx");

test("the switch lives in Settings, with a channel each", () => {
  assert.match(settings, /Scheduling notifications/);
  assert.match(settings, /aria-label="Ask about emailing the customer"/);
  assert.match(settings, /aria-label="Ask about texting the customer"/);
});

test("both channels start off, so nothing can leave until somebody says so", () => {
  assert.match(settings, /useState\(false\)/);
  assert.doesNotMatch(settings, /useState\(true\)/);
});

test("the screen admits a text cannot be delivered yet", () => {
  assert.match(settings, /no text-message provider connected/);
});

test("the prompt is a dialog, because TOAST_LIMIT is 1 and undo holds that slot", () => {
  assert.match(prompt, /<Dialog /);
  assert.doesNotMatch(prompt, /toast\(\{[\s\S]{0,120}action:/);
});

test("the prompt asks, and says plainly that nothing has gone yet", () => {
  assert.match(prompt, /Tell the customer\?/);
  assert.match(prompt, /Nothing has been sent yet/);
  assert.match(prompt, /No, don/);
  assert.match(prompt, /Yes, tell them/);
});

test("the server decides whether to ask; the screens do not invent a rule", () => {
  assert.match(prompt, /if \(!decision\?\.prompt \|\| typeof result\?\.id !== "number"\) return;/);
});

test("saying no still tells the server, so the choice is recorded", () => {
  assert.match(prompt, /body: JSON\.stringify\(\{ send, kind: pending\.decision\.kind \}\)/);
});

test("it is mounted once, near the root", () => {
  assert.match(layout, /<ScheduleNotificationPromptHost \/>/);
  assert.equal((layout.match(/<ScheduleNotificationPromptHost \/>/g) ?? []).length, 1);
});

test("every screen that moves a job asks", () => {
  for (const [label, source] of [["the calendar", calendar], ["the job page", jobDetail], ["the schedule", schedule]] as const) {
    assert.match(source, /askAboutSchedule\(/, `${label} never asks`);
  }
});

test("undo does not ask again — it is a second forward move, not a rollback", () => {
  assert.match(calendar, /moveJob\(occurrence\.id, from, false\)/);
  assert.match(calendar, /\(jobId: number, to: string, ask = true\)/);
});

test("the job page asks only once the save is confirmed", () => {
  const success = jobDetail.slice(jobDetail.indexOf("onSuccess: (committedJob"), jobDetail.indexOf("askAboutSchedule("));
  assert.match(success, /Save not confirmed/,
    "the unconfirmed-save guard has to come first, or a refused move would still ask");
});
