import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { inProspectScope, isDeactivated, listOf, resolvedLifecycle } from "./profile-lists.ts";
import { kyleAnswers20261024V1Migration } from "../migrations/kyle-answers-2026-10-24-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Kyle, 2026-10-24.
describe("Archived and Deactivated are one thing, and a profile keeps its list", () => {
  it("both are deactivated", () => {
    assert.equal(isDeactivated("inactive"), true);
    assert.equal(isDeactivated("archived"), true);
    assert.equal(isDeactivated("prospect"), false);
  });

  it("an active profile is in its own list; a deactivated one in the list it came from", () => {
    assert.equal(listOf({ lifecycleStatus: "prospect" }), "prospect");
    assert.equal(listOf({ lifecycleStatus: "inactive", deactivatedFrom: "prospect" }), "prospect");
    assert.equal(listOf({ lifecycleStatus: "archived", deactivatedFrom: "customer" }), "customer");
  });

  it("deactivated before the column existed: a customer since date says it was a customer", () => {
    assert.equal(listOf({ lifecycleStatus: "inactive", customerDate: "2026-09-01" }), "customer");
    assert.equal(listOf({ lifecycleStatus: "inactive", customerDate: null }), "prospect");
  });

  it("reactivating returns a prospect to the prospects — it used to make it a customer", () => {
    const prospect = { lifecycleStatus: "inactive", deactivatedFrom: "prospect" };
    assert.equal(resolvedLifecycle(prospect, "customer", false), "prospect", "the old status:\"active\" means back to its list");
    assert.equal(resolvedLifecycle({ lifecycleStatus: "inactive", deactivatedFrom: "customer" }, "customer", false), "customer");
    assert.equal(resolvedLifecycle(prospect, "customer", true), "customer", "an explicit lifecycle is honoured");
    assert.equal(resolvedLifecycle({ lifecycleStatus: "prospect" }, "inactive", false), "inactive");
  });

  it("a /prospects route serves a deactivated prospect, not a deactivated customer", () => {
    assert.equal(inProspectScope({ lifecycleStatus: "inactive", deactivatedFrom: "prospect" }), true);
    assert.equal(inProspectScope({ lifecycleStatus: "inactive", deactivatedFrom: "customer" }), false);
    assert.equal(inProspectScope({ lifecycleStatus: "customer" }), false);
  });
});

describe("the routes", () => {
  const route = read("../routes/customers.ts");

  it("each list shows its deactivated profiles only when asked", () => {
    assert.match(route, /inProfileList\(lifecycle, String\(includeDeactivated \?\? ""\) === "true"\)/);
  });

  it("every /prospects/:id route accepts a deactivated prospect", () => {
    assert.equal((route.match(/\? and\(eq\(customersTable\.id, id\), inProfileList\("prospect", true\)\)/g) ?? []).length, 4);
    assert.doesNotMatch(route, /and\(eq\(customersTable\.id, id\), eq\(customersTable\.lifecycleStatus, "prospect"\)\)/);
  });

  it("editing a prospect never changes its lifecycle — it used to reactivate a deactivated one", () => {
    assert.doesNotMatch(route, /\{ \.\.\.req\.body, status: "prospect", lifecycleStatus: "prospect" \}/);
    assert.match(route, /\(\{ status: _status, lifecycleStatus: _lifecycle, \.\.\.rest \}\) => rest/);
  });

  it("deactivating remembers the list; reactivating clears it", () => {
    assert.match(route, /updatePayload\.deactivatedFrom   = listOf\(current\);/);
    assert.match(route, /updatePayload\.deactivatedFrom    = null;/);
  });
});

describe("the migration — two additive columns", () => {
  const run = (state: { columns: number; deactivated: number; pending: number }) => {
    const calls: string[] = [];
    const context: any = {
      environment: "sandbox",
      client: {
        query: async (text: string) => {
          calls.push(text);
          if (text.includes("information_schema.columns")) return { rows: [{ count: state.columns }] };
          if (text.includes("ADD COLUMN")) state.columns = 2;
          if (text.includes("DROP COLUMN")) state.columns = 0;
          if (text.trim().startsWith("UPDATE customers")) return { rows: [], rowCount: state.deactivated };
          if (text.includes("deactivated_from IS NULL")) return { rows: [{ count: 0 }] };
          if (text.includes("WHERE price_pending")) return { rows: [{ count: state.pending }] };
          if (text.includes("application_migration_backups") && text.includes("SELECT COUNT")) return { rows: [{ count: 1 }] };
          if (text.includes("COUNT(*)::int AS count FROM customers")) return { rows: [{ count: state.deactivated }] };
          return { rows: [], rowCount: 0 };
        },
      },
    };
    return { context, calls };
  };

  it("adds the columns, fills only the deactivated profiles, and changes no price", async () => {
    const state = { columns: 0, deactivated: 2, pending: 0 };
    const { context, calls } = run(state);
    const pre = await kyleAnswers20261024V1Migration.preflight(context);
    await kyleAnswers20261024V1Migration.backup(context, pre);
    const applied = await kyleAnswers20261024V1Migration.apply(context, pre);
    await kyleAnswers20261024V1Migration.postflight(context, pre);
    assert.equal(applied.deactivatedFilled, 2);
    assert.ok(!calls.some((call) => /UPDATE quote_line_items|UPDATE quotes/.test(call)), "no estimate is rewritten");
  });

  it("rollback refuses while a line is still to be quoted", async () => {
    const state = { columns: 2, deactivated: 0, pending: 1 };
    const { context } = run(state);
    await assert.rejects(kyleAnswers20261024V1Migration.rollback(context), /still to be quoted/);
  });

  it("is Sandbox-only and registered", async () => {
    const { context } = run({ columns: 0, deactivated: 0, pending: 0 });
    await assert.rejects(kyleAnswers20261024V1Migration.preflight({ ...context, environment: "production" }), /Sandbox-only/);
    assert.ok(REQUIRED_MIGRATIONS.includes(kyleAnswers20261024V1Migration as never));
  });
});
