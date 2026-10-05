/**
 * Kyle (Testing Edits, 2026-10-01) #14, as guards.
 *
 * *"Anywhere Corstead asks the user to select a time, use 15-minute increments
 * … Use standard AM / PM formatting. Apply this consistently … throughout the
 * platform."*
 *
 * "Anywhere" and "consistently" are the whole point, so these sweep the source
 * tree rather than naming screens: a new `<input type="time">` or a new
 * hand-rolled formatter fails here wherever somebody puts it.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
    }
  };
  walk(SRC);
  return found;
}

/** The file with comments and strings-in-comments removed. */
const codeOf = (path: string) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("#14 nothing asks for a time with a free-text time input", () => {
  // `<input type="time">` accepts 8:07 and shows whatever the browser's locale
  // chooses — on a machine set outside the United States, no AM or PM at all.
  const offenders = sourceFiles()
    .filter((path) => /type=["']time["']/.test(codeOf(path)))
    .map((path) => relative(SRC, path));
  assert.deepEqual(offenders, [], `use TimeSelect instead: ${offenders.join(", ")}`);
});

test("#14 every screen that asks for a time uses the one selector", () => {
  const sites = [
    "pages/QuoteNew.tsx",
    "pages/QuoteDetail.tsx",
    "pages/JobNew.tsx",
    "pages/JobDetail.tsx",
    "pages/Schedule.tsx",
    "pages/Customers.tsx",
    "pages/Settings.tsx",
    "components/SchedulingQueue.tsx",
    "components/EstimateConversionDialog.tsx",
  ];
  for (const site of sites) {
    const source = readFileSync(join(SRC, site), "utf8");
    assert.match(source, /<TimeSelect/, `${site} does not use TimeSelect`);
    assert.match(source, /from "@\/components\/TimeSelect"/, `${site} does not import it`);
  }
});

test("#14 the selector offers the grid and keeps the stored value", () => {
  const component = readFileSync(join(SRC, "components/TimeSelect.tsx"), "utf8");
  assert.match(component, /timeSelectOptions\(current\)/);
  assert.match(component, /toTimeValue\(value\)/);
  // A native select: one tap on a phone, and the keyboard jumps by typing.
  assert.match(component, /<select/);
});

test("#14 one formatter, not seven", () => {
  // Dashboard, Jobs, Schedule, JobDetail, MonthCalendar and crew-overlap had
  // each grown their own, producing "8:15am", "8:15 am" and "8:15a".
  const offenders = sourceFiles()
    .filter((path) => !/time-of-day\.ts$/.test(path))
    .filter((path) => /%\s*12\s*\|\|\s*12/.test(codeOf(path)))
    .map((path) => relative(SRC, path));
  assert.deepEqual(offenders, [], `use formatTimeOfDay: ${offenders.join(", ")}`);

  for (const site of [
    "pages/Dashboard.tsx",
    "pages/Jobs.tsx",
    "pages/Schedule.tsx",
    "pages/JobDetail.tsx",
    "components/MonthCalendar.tsx",
    "lib/crew-overlap.ts",
  ]) {
    assert.match(readFileSync(join(SRC, site), "utf8"), /formatTimeOfDay\(/, `${site} formats its own`);
  }
});

test("#14 a job's live time is still read from the control that holds it", () => {
  // The control is a <select> now, which reports its type as "select-one".
  // Without that, submitting fell back to React state and the guard was dead.
  const source = readFileSync(join(SRC, "lib/job-new-scheduled-date.ts"), "utf8");
  assert.match(source, /control\.type === "select-one"/);
});
