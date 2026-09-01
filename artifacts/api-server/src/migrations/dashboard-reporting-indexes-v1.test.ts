import assert from "node:assert/strict";
import test from "node:test";
import { dashboardReportingIndexesV1Migration } from "./dashboard-reporting-indexes-v1.ts";

test("dashboard reporting migration is additive, verifiable, and reversible", async () => {
  const calls: string[] = [];
  let present = 0;
  const context: any = {
    environment: "sandbox",
    migrationId: dashboardReportingIndexesV1Migration.id,
    client: {
      query: async (text: string) => {
        calls.push(text);
        if (text.startsWith("CREATE INDEX")) present += 1;
        if (text.startsWith("DROP INDEX")) present -= 1;
        if (text.includes("FROM pg_indexes")) return { rows: [{ count: present }] };
        return { rows: [], rowCount: 0 };
      },
    },
  };
  const preflight = await dashboardReportingIndexesV1Migration.preflight(context);
  assert.equal(preflight.existing, 0);
  await dashboardReportingIndexesV1Migration.apply(context, preflight);
  await dashboardReportingIndexesV1Migration.postflight(context, preflight);
  assert.equal(calls.filter((call) => call.startsWith("CREATE INDEX IF NOT EXISTS")).length, 3);
  await dashboardReportingIndexesV1Migration.rollback(context);
  assert.equal(present, 0);
});