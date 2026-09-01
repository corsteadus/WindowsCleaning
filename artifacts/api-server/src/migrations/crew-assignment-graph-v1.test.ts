import assert from "node:assert/strict";
import test from "node:test";
import { crewAssignmentGraphV1Migration } from "./crew-assignment-graph-v1.ts";

function catalogContext(orphanCount = 0, membershipRows = 0): any {
  const calls: string[] = [];
  return {
    calls,
    environment: "sandbox",
    migrationId: crewAssignmentGraphV1Migration.id,
    client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("to_regclass")) return { rows: [{ table_name: "crew_members" }] };
      if (text.includes("information_schema.columns")) return { rows: [{ count: 7 }] };
      if (text.includes("FROM pg_indexes")) return { rows: [
        { indexname: "idx_jobs_assigned_technician_user_id", indexdef: "CREATE INDEX idx_jobs_assigned_technician_user_id ON jobs USING btree (assigned_technician_user_id)" },
        { indexname: "crew_members_crew_user_unique", indexdef: "CREATE UNIQUE INDEX crew_members_crew_user_unique ON crew_members USING btree (crew_id, user_id)" },
        { indexname: "crew_members_one_lead_unique", indexdef: "CREATE UNIQUE INDEX crew_members_one_lead_unique ON crew_members USING btree (crew_id) WHERE (role = 'lead'::text)" },
        { indexname: "crew_members_user_crew_idx", indexdef: "CREATE INDEX crew_members_user_crew_idx ON crew_members USING btree (user_id, crew_id)" },
        { indexname: "crew_members_crew_role_idx", indexdef: "CREATE INDEX crew_members_crew_role_idx ON crew_members USING btree (crew_id, role)" },
      ] };
      if (text.includes("con.contype = 'f'")) return { rows: [{ count: 1 }] };
      if (text.includes("crew_members_role_check")) return { rows: [{ definition: "CHECK ((role = ANY (ARRAY['lead'::text, 'member'::text])))" }] };
      if (text.includes("LEFT JOIN")) return { rows: [{ count: orphanCount }] };
      if (text.includes("assigned_technician_user_id IS NOT NULL")) return { rows: [{ count: 0 }] };
      if (text.includes("FROM crew_members") && text.includes("count")) return { rows: [{ count: membershipRows }] };
      if (text.includes("FROM crews") || text.includes("FROM jobs")) return { rows: [{ count: 3 }] };
      return { rows: [] };
    } },
  };
}

test("refuses orphaned references before additive constraint DDL", async () => {
  const context = catalogContext(1);
  const preflight = await crewAssignmentGraphV1Migration.preflight(context);
  await assert.rejects(() => crewAssignmentGraphV1Migration.apply(context, preflight), /orphan references/);
  assert.equal(context.calls.some((sql: string) => sql.includes("ADD CONSTRAINT")), false);
});

test("catalog verification requires exact RESTRICT foreign keys and definitions", async () => {
  const context = catalogContext();
  const preflight = await crewAssignmentGraphV1Migration.preflight(context);
  await crewAssignmentGraphV1Migration.apply(context, preflight);
  const result = await crewAssignmentGraphV1Migration.postflight(context, preflight);
  assert.equal(result.foreignKeys, 4);
  assert.equal(result.indexes, 5);
  assert.equal(result.roleChecks, 1);
  assert.ok(context.calls.some((sql: string) => sql.includes("ON DELETE RESTRICT")));
});

test("rollback refuses normalized data and only drops additive objects when empty", async () => {
  const blocked = catalogContext(0, 1);
  await assert.rejects(() => crewAssignmentGraphV1Migration.rollback(blocked), /would be lost/);
  const empty = catalogContext();
  await crewAssignmentGraphV1Migration.rollback(empty);
  assert.ok(empty.calls.some((sql: string) => sql.startsWith("ALTER TABLE jobs DROP COLUMN")));
  assert.ok(empty.calls.some((sql: string) => sql.startsWith("DROP TABLE IF EXISTS crew_members")));
});