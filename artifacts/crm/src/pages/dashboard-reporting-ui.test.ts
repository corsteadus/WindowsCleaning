import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard exposes every required period and typed comparison metrics", async () => {
  const source = await readFile(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  for (const period of ["today", "last_7_days", "last_month", "last_quarter", "this_year"]) {
    assert.match(source, new RegExp(`DashboardPeriod\\.${period}`));
  }
  assert.match(source, /useGetDashboardStats\(/);
  assert.match(source, /enabled: canReport/);
  assert.match(source, /percentChange === null/);
  assert.match(source, /Sales = posted payments/);
  assert.match(source, /Close rate excludes open and undated legacy estimates/);
});