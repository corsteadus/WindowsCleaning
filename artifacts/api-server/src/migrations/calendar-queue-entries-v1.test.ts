import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM,
  CALENDAR_QUEUE_ENTRIES_V1_ID,
  calendarQueueEntriesV1Migration as migration,
} from "./calendar-queue-entries-v1.ts";

type FakeOptions = {
  openUndatedJobs?: number;
  queuedEntries?: number;
  undatedJobsWithoutEntry?: number;
  queueStatusOutOfScope?: number;
  columnExists?: boolean;
  constraints?: number;
  indexes?: number;
  inserted?: number;
  authoredOutsideBackfill?: number;
};

const CONSTRAINT_COUNT = 2;
const INDEX_COUNT = 1;

function fakeContext(options: FakeOptions = {}): any {
  const o = {
    openUndatedJobs: 4,
    queuedEntries: 0,
    undatedJobsWithoutEntry: 0,
    queueStatusOutOfScope: 0,
    columnExists: true,
    constraints: CONSTRAINT_COUNT,
    indexes: INDEX_COUNT,
    inserted: 4,
    authoredOutsideBackfill: 0,
    ...options,
  };
  const calls: string[] = [];
  let columnAdded = false;

  return {
    calls,
    environment: "sandbox",
    migrationId: migration.id,
    client: {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes("information_schema.columns")) {
          return { rows: [{ exists: o.columnExists || columnAdded }] };
        }
        if (text.startsWith("ALTER TABLE schedule_entries ADD COLUMN")) {
          columnAdded = true;
          return { rows: [] };
        }
        // Before the LEFT JOIN branch: the backfill names it in its own FROM.
        if (text.startsWith("INSERT INTO schedule_entries")) {
          return { rows: Array.from({ length: o.inserted }, (_, i) => ({ id: i + 1 })) };
        }
        if (text.includes("created_by IS DISTINCT FROM")) {
          return { rows: [{ count: o.authoredOutsideBackfill }] };
        }
        if (text.includes("queue_status IS NOT NULL")) {
          return { rows: [{ count: o.queueStatusOutOfScope }] };
        }
        if (text.includes("LEFT JOIN schedule_entries")) {
          return { rows: [{ count: o.undatedJobsWithoutEntry }] };
        }
        if (text.includes("status = 'queued'") && text.includes("count(*)")) {
          return { rows: [{ count: o.queuedEntries }] };
        }
        if (text.includes("FROM jobs") && text.includes("count(*)")) {
          return { rows: [{ count: o.openUndatedJobs }] };
        }
        if (text.includes("FROM pg_constraint")) {
          return { rows: Array.from({ length: o.constraints }, (_, i) => ({ conname: `c_${i}` })) };
        }
        if (text.includes("FROM pg_indexes")) {
          return { rows: Array.from({ length: o.indexes }, (_, i) => ({ indexname: `i_${i}` })) };
        }
        return { rows: [] };
      },
    },
  };
}

test("the checksum is derived from the DDL, not hand-written", () => {
  assert.match(CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM, /^[0-9a-f]{64}$/);
  assert.equal(migration.checksum, CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM);
  assert.equal(CALENDAR_QUEUE_ENTRIES_V1_ID, "calendar_queue_entries_v1");
  assert.equal(migration.required, true);
});

test("it is a separate migration, so the first one's checksum is untouched", async () => {
  const { CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM } = await import("./calendar-schedule-entries-v1.ts");
  assert.notEqual(CALENDAR_QUEUE_ENTRIES_V1_CHECKSUM, CALENDAR_SCHEDULE_ENTRIES_V1_CHECKSUM);
});

test("apply adds the column, both constraints and the queue index", async () => {
  const context = fakeContext({ columnExists: false });
  const preflight = await migration.preflight(context);
  await migration.apply(context, preflight);

  assert.ok(context.calls.some((s: string) => s.includes("ADD COLUMN IF NOT EXISTS queue_status")));
  assert.equal(context.calls.filter((s: string) => s.includes("ADD CONSTRAINT")).length, CONSTRAINT_COUNT);
  assert.ok(context.calls.some((s: string) => s.includes("schedule_entries_queue_idx")));
});

test("the queue index orders on what a page is walked by", async () => {
  const context = fakeContext({ columnExists: false });
  await migration.apply(context, await migration.preflight(context));
  const ddl = context.calls.find((s: string) => s.includes("CREATE INDEX IF NOT EXISTS schedule_entries_queue_idx"));
  // Keyset pagination reads by state, oldest first, id breaking ties.
  assert.match(ddl, /\(status, created_at, id\)/);
});

test("only undated open jobs without an entry are queued, and each is primary", async () => {
  const context = fakeContext({ columnExists: false, inserted: 4 });
  const result = await migration.apply(context, await migration.preflight(context));
  assert.equal(result.queuedEntriesBackfilled, 4);

  const insert = context.calls.find((s: string) => s.startsWith("INSERT INTO schedule_entries"));
  assert.match(insert, /j\.scheduled_date IS NULL/);
  assert.match(insert, /e\.id IS NULL/);
  assert.match(insert, /'queued', 'needs_contact'/);
  // Primary, so it carries the job's value under the same anchoring rule.
  assert.match(insert, /j\.id, 1, true, NULL/);
  assert.match(insert, /ROUND\(j\.total_amount \* 100\)/);
});

test("completed and cancelled jobs are never dragged into the queue", async () => {
  const context = fakeContext({ columnExists: false });
  await migration.apply(context, await migration.preflight(context));
  const insert = context.calls.find((s: string) => s.startsWith("INSERT INTO schedule_entries"));
  assert.match(insert, /j\.status IN \('unscheduled', 'scheduled', 'pending'\)/);
  assert.ok(!insert.includes("'completed'"));
  assert.ok(!insert.includes("'canceled'"));
});

test("apply refuses, and says why, when live rows would break the new constraint", async () => {
  const context = fakeContext({ queueStatusOutOfScope: 3 });
  const preflight = await migration.preflight(context);
  await assert.rejects(
    () => migration.apply(context, preflight),
    /3 schedule entries carry a queue_status .*Clear those values/s,
  );
  assert.equal(context.calls.some((s: string) => s.includes("ADD CONSTRAINT")), false);
});

test("postflight fails if any open undated job was left unqueued", async () => {
  const preflight = await migration.preflight(fakeContext());
  await assert.rejects(
    () => migration.postflight(fakeContext({ undatedJobsWithoutEntry: 2 }), preflight),
    /2 open undated jobs have no queue entry/,
  );
});

test("postflight fails if the jobs table changed underneath the migration", async () => {
  const preflight = await migration.preflight(fakeContext({ openUndatedJobs: 4 }));
  await assert.rejects(
    () => migration.postflight(fakeContext({ openUndatedJobs: 5 }), preflight),
    /must not change the jobs table/,
  );
});

test("postflight fails when the column, a constraint or the index did not land", async () => {
  const preflight = await migration.preflight(fakeContext());
  for (const broken of [{ columnExists: false }, { constraints: 1 }, { indexes: 0 }]) {
    await assert.rejects(
      () => migration.postflight(fakeContext(broken), preflight),
      /catalog verification failed/,
    );
  }
});

test("verify passes on a healthy schema and reports what it checked", async () => {
  const result = await migration.verify(fakeContext());
  assert.equal(result.constraints, CONSTRAINT_COUNT);
  assert.equal(result.indexes, INDEX_COUNT);
  assert.equal(result.undatedJobsWithoutEntry, 0);
});

test("rollback refuses once anyone has queued or held work themselves", async () => {
  await assert.rejects(
    () => migration.rollback(fakeContext({ authoredOutsideBackfill: 1 })),
    /created outside the backfill would be lost/,
  );
});

test("rollback removes only its own rows and column, and never touches jobs", async () => {
  const context = fakeContext();
  const result = await migration.rollback(context);
  assert.equal(result.jobRowsChanged, 0);

  const del = context.calls.find((s: string) => s.startsWith("DELETE FROM schedule_entries"));
  // Scoped to rows this migration created, not every queued row.
  assert.match(del, /created_by = 'migration:calendar_queue_entries_v1'/);
  assert.ok(context.calls.some((s: string) => s.includes("DROP COLUMN IF EXISTS queue_status")));
  assert.equal(context.calls.some((s: string) => s.includes("jobs")), false);
});
