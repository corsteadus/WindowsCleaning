import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("team-tech schedule empty render state scopes auxiliary queries and preserves the weekly shell", async () => {
  const schedule = await readFile(new URL("./Schedule.tsx", import.meta.url), "utf8");

  // The exact permitted job responses used by a no-assignment team technician
  // render as arrays, while the auxiliary endpoints are disabled before issue.
  assert.match(schedule, /export function normalizeScheduleList/);
  assert.match(schedule, /if \(Array\.isArray\(value\)\) return value/);
  assert.match(schedule, /Array\.isArray\(\(value as \{ data\?: unknown \}\)\.data\)/);
  assert.match(schedule, /enabled: canViewDuePlans/);
  assert.match(schedule, /enabled: canViewEstimates/);
  assert.match(schedule, /enabled: canViewScheduleJobs/);
  assert.match(schedule, /authScopedQueryKey\(user, \["due-for-service"\]\)/);
  assert.match(schedule, /authScopedQueryKey\(user, getListUnscheduledJobsQueryKey\(\)\)/);
  assert.match(schedule, /authScopedQueryKey\(user, \["estimate-calendar", startStr, endStr\]\)/);

  // With all permitted job lists empty the non-loading branch supplies all
  // seven DaySection empty cells plus the explicit seven-day empty message.
  assert.match(schedule, /<h1[^>]*>Schedule<\/h1>/);
  assert.match(schedule, /days\.map\(\(day\)/);
  assert.match(schedule, /getScheduleEmptyStateCopy\(user\)/);
  assert.match(schedule, /\{emptyStateCopy\.title\}/);
  assert.match(schedule, /\{emptyStateCopy\.description\}/);
  assert.match(schedule, /<Layout>/);
});

test("customer and property empty states consume capability-aware assigned-work copy", async () => {
  const [customers, properties] = await Promise.all([
    readFile(new URL("./Customers.tsx", import.meta.url), "utf8"),
    readFile(new URL("./Properties.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(customers, /getCustomersEmptyStateDescription\(user\)/);
  assert.match(customers, /: emptyStateDescription/);
  assert.match(properties, /getPropertiesEmptyStateDescription\(user\)/);
  assert.match(properties, /\{emptyStateDescription\}/);
});