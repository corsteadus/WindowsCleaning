import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM,
  CALENDAR_SCHEDULE_ENTRIES_V1_ID,
  calendarScheduleEntriesV1Migration as migration,
} from "./calendar-schedule-entries-v1.ts";

type FakeOptions = {
  jobRows?: number;
  datedJobRows?: number;
  entryRows?: number;
  primaryEntryRows?: number;
  missingEntries?: number;
  orphanEntries?: number;
  duplicatePrimaries?: number;
  tablesExist?: boolean;
  foreignKeys?: number;
  indexes?: number;
  inserted?: number;
  authoredOutsideBackfill?: number;
  eventRows?: number;
  unmigratableJobs?: number;
};

const FK_COUNT = 7;
const INDEX_COUNT = 18;

function fakeContext(options: FakeOptions = {}): any {
  const o = {
    jobRows: 10,
    datedJobRows: 6,
    entryRows: 0,
    primaryEntryRows: 0,
    missingEntries: 0,
    orphanEntries: 0,
    duplicatePrimaries: 0,
    tablesExist: true,
    foreignKeys: FK_COUNT,
    indexes: INDEX_COUNT,
    inserted: 6,
    authoredOutsideBackfill: 0,
    eventRows: 0,
    unmigratableJobs: 0,
    ...options,
  };
  const calls: string[] = [];
  let ddlApplied = false;

  return {
    calls,
    environment: "sandbox",
    migrationId: migration.id,
    client: {
      query: async (text: string) => {
        calls.push(text);

        if (text.includes("information_schema.tables")) {
          // Before the DDL runs the tables are absent unless the fixture says
          // they already exist.
          return { rows: [{ exists: o.tablesExist || ddlApplied }] };
        }
        if (text.startsWith("CREATE TABLE")) {
          ddlApplied = true;
          return { rows: [] };
        }
        // Before the LEFT JOIN branches below: the backfill statement contains
        // one of their fragments in its own FROM clause.
        if (text.startsWith("INSERT INTO schedule_entries")) {
          return { rows: Array.from({ length: o.inserted }, (_, i) => ({ id: i + 1 })) };
        }
        // Before the plain jobs counts: this one also selects from jobs and
        // filters on scheduled_date.
        if (text.includes("total_amount < 0")) return { rows: [{ count: o.unmigratableJobs }] };
        if (text.includes("HAVING count(*) > 1")) return { rows: [{ count: o.duplicatePrimaries }] };
        if (text.includes("LEFT JOIN schedule_entries")) return { rows: [{ count: o.missingEntries }] };
        if (text.includes("LEFT JOIN jobs j ON j.id = e.job_id")) return { rows: [{ count: o.orphanEntries }] };
        if (text.includes("created_by IS DISTINCT FROM")) return { rows: [{ count: o.authoredOutsideBackfill }] };
        if (text.includes("FROM schedule_entries WHERE is_primary")) return { rows: [{ count: o.primaryEntryRows }] };
        if (text.includes("FROM schedule_entries")) return { rows: [{ count: o.entryRows }] };
        if (text.includes("FROM calendar_events") || text.includes("FROM calendar_preferences")) {
          return { rows: [{ count: o.eventRows }] };
        }
        if (text.includes("scheduled_date IS NOT NULL") && text.includes("count(*)")) {
          return { rows: [{ count: o.datedJobRows }] };
        }
        if (text.includes("FROM jobs") && text.includes("count(*)")) return { rows: [{ count: o.jobRows }] };
        if (text.includes("FROM pg_constraint")) {
          return { rows: Array.from({ length: o.foreignKeys }, (_, i) => ({ conname: `fk_${i}` })) };
        }
        if (text.includes("FROM pg_indexes")) {
          return { rows: Array.from({ length: o.indexes }, (_, i) => ({ indexname: `idx_${i}` })) };
        }
        return { rows: [] };
      },
    },
  };
}

test("the checksum is derived from the DDL, not hand-written", () => {
  assert.match(CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM, /^[0-9a-f]{64}$/);
  assert.equal(CALENDAR_SCHEDULE_ENTRIES_V1_ID, "calendar_schedule_entries_v1");
  assert.equal(migration.checksum, CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM);
  assert.equal(migration.required, true);
});

test("preflight counts dated jobs before the tables exist", async () => {
  const context = fakeContext({ tablesExist: false, datedJobRows: 4 });
  const preflight = await migration.preflight(context);
  assert.equal(preflight.datedJobRows, 4);
  assert.equal(preflight.entryRows, 0);
  // With no table yet, every dated job is by definition missing an entry.
  assert.equal(preflight.datedJobsWithoutEntry, 4);
});

test("apply creates every table, key and index, then backfills one primary entry per dated job", async () => {
  const context = fakeContext({ tablesExist: false, datedJobRows: 6, inserted: 6 });
  const preflight = await migration.preflight(context);
  const result = await migration.apply(context, preflight);

  assert.equal(result.entriesBackfilled, 6);
  for (const table of ["schedule_entries", "schedule_assignments", "calendar_events", "calendar_preferences"]) {
    assert.ok(
      context.calls.some((sql: string) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)),
      `expected ${table} to be created`,
    );
  }
  assert.equal(
    context.calls.filter((sql: string) => sql.includes("ADD CONSTRAINT")).length,
    FK_COUNT,
  );
  assert.equal(
    context.calls.filter((sql: string) => sql.startsWith("CREATE UNIQUE INDEX") || sql.startsWith("CREATE INDEX")).length,
    INDEX_COUNT,
  );
});

test("the backfill anchors the whole job value, in cents, to the primary entry", async () => {
  const context = fakeContext({ tablesExist: false });
  const preflight = await migration.preflight(context);
  await migration.apply(context, preflight);

  const insert = context.calls.find((sql: string) => sql.startsWith("INSERT INTO schedule_entries"));
  assert.ok(insert, "expected a backfill insert");
  // Full amount converted to whole cents, and every backfilled row is primary.
  assert.match(insert, /ROUND\(j\.total_amount \* 100\)/);
  assert.match(insert, /SELECT\s+j\.id, 1, true,/);
  // Only jobs that actually have a date, and only those without an entry yet.
  assert.match(insert, /WHERE j\.scheduled_date IS NOT NULL AND e\.id IS NULL/);
});

test("apply refuses to touch the schema when a job already has two primary entries", async () => {
  const context = fakeContext({ duplicatePrimaries: 1 });
  const preflight = await migration.preflight(context);
  await assert.rejects(() => migration.apply(context, preflight), /consistency check failed/);
  assert.equal(context.calls.some((sql: string) => sql.startsWith("CREATE TABLE")), false);
});

test("apply refuses, and says why, when a dated job could not become a valid entry", async () => {
  // This migration runs during server startup, so a bare constraint violation
  // here would stop the process booting with only a constraint name to go on.
  const context = fakeContext({ unmigratableJobs: 2 });
  const preflight = await migration.preflight(context);
  await assert.rejects(
    () => migration.apply(context, preflight),
    /2 dated job\(s\) have a malformed .*Correct those job rows/s,
  );
  assert.equal(context.calls.some((sql: string) => sql.startsWith("CREATE TABLE")), false);
});

test("the source-data guard checks exactly what the table's own constraints require", async () => {
  const context = fakeContext();
  await migration.preflight(context);
  const guard = context.calls.find((sql: string) => sql.includes("total_amount < 0"));
  assert.ok(guard, "expected a source-data guard query");
  // Times may carry seconds: the API has always accepted HH:mm and HH:mm:ss.
  assert.match(guard, /\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\(:\[0-5\]\[0-9\]\)\?\$/);
  assert.match(guard, /scheduled_date !~/);
  assert.match(guard, /estimated_duration < 0/);
});

test("money is written as numeric cents, wide enough for any numeric(10,2) amount", async () => {
  const context = fakeContext({ tablesExist: false });
  const preflight = await migration.preflight(context);
  await migration.apply(context, preflight);

  const ddl = context.calls.find((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS schedule_entries"));
  // An int4 would overflow: jobs.total_amount reaches 9,999,999,999 cents.
  assert.match(ddl, /allocated_value_cents numeric\(18,0\) NOT NULL DEFAULT 0/);
  const insert = context.calls.find((sql: string) => sql.startsWith("INSERT INTO schedule_entries"));
  assert.ok(!insert.includes("::int"), "the amount must not be cast down to int4");
});

test("both spellings of a cancelled job are carried across", async () => {
  const context = fakeContext({ tablesExist: false });
  const preflight = await migration.preflight(context);
  await migration.apply(context, preflight);

  const insert = context.calls.find((sql: string) => sql.startsWith("INSERT INTO schedule_entries"));
  assert.match(insert, /j\.status IN \('canceled', 'cancelled'\)/);
});

test("apply refuses when a schedule entry points at a job that is gone", async () => {
  const context = fakeContext({ orphanEntries: 2 });
  const preflight = await migration.preflight(context);
  await assert.rejects(() => migration.apply(context, preflight), /consistency check failed/);
});

test("postflight fails if any dated job was left without an entry", async () => {
  const context = fakeContext({ tablesExist: false });
  const preflight = await migration.preflight(context);
  await migration.apply(context, preflight);

  const stalled = fakeContext({ missingEntries: 3 });
  await assert.rejects(
    () => migration.postflight(stalled, preflight),
    /3 dated jobs have no primary schedule entry/,
  );
});

test("postflight fails if the jobs table changed underneath the migration", async () => {
  const preflight = await migration.preflight(fakeContext({ jobRows: 10 }));
  const shifted = fakeContext({ jobRows: 11 });
  await assert.rejects(() => migration.postflight(shifted, preflight), /must not change the jobs table/);
});

test("postflight fails when a foreign key or index did not land", async () => {
  const preflight = await migration.preflight(fakeContext());
  await assert.rejects(
    () => migration.postflight(fakeContext({ foreignKeys: FK_COUNT - 1 }), preflight),
    /catalog verification failed/,
  );
  await assert.rejects(
    () => migration.postflight(fakeContext({ indexes: INDEX_COUNT - 1 }), preflight),
    /catalog verification failed/,
  );
});

test("verify passes on a healthy schema and reports what it checked", async () => {
  const result = await migration.verify(fakeContext());
  assert.equal(result.foreignKeys, FK_COUNT);
  assert.equal(result.indexes, INDEX_COUNT);
  assert.equal(result.datedJobsWithoutEntry, 0);
});

test("rollback refuses once anyone has scheduled work the backfill did not create", async () => {
  await assert.rejects(
    () => migration.rollback(fakeContext({ authoredOutsideBackfill: 1 })),
    /created outside the backfill would be lost/,
  );
});

test("rollback refuses while calendar events or preferences hold data", async () => {
  await assert.rejects(
    () => migration.rollback(fakeContext({ eventRows: 4 })),
    /cannot be reproduced/,
  );
});

test("rollback drops only its own tables and never writes to jobs", async () => {
  const context = fakeContext();
  const result = await migration.rollback(context);
  assert.equal(result.jobRowsChanged, 0);
  for (const table of ["schedule_assignments", "schedule_entries", "calendar_events", "calendar_preferences"]) {
    assert.ok(
      context.calls.some((sql: string) => sql === `DROP TABLE IF EXISTS ${table}`),
      `expected ${table} to be dropped`,
    );
  }
  assert.equal(context.calls.some((sql: string) => sql.includes("ALTER TABLE jobs")), false);
  assert.equal(context.calls.some((sql: string) => sql.includes("DELETE FROM jobs")), false);
});
