import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_ENTRY_SYNC_V1_CHECKSUM,
  CALENDAR_ENTRY_SYNC_V1_ID,
  SYNC_FUNCTION_SQL,
  SYNC_TRIGGER_SQL,
  calendarEntrySyncV1Migration as migration,
} from "./calendar-entry-sync-v1.ts";

type FakeOptions = {
  jobs?: number;
  missingPrimary?: number;
  functionExists?: boolean;
  triggerEnabled?: boolean;
  reconciled?: number;
};

function fakeContext(options: FakeOptions = {}): any {
  const o = {
    jobs: 5,
    missingPrimary: 0,
    functionExists: true,
    triggerEnabled: true,
    reconciled: 0,
    ...options,
  };
  const calls: string[] = [];
  return {
    calls,
    environment: "sandbox",
    migrationId: migration.id,
    client: {
      query: async (text: string) => {
        calls.push(text);
        // Before the missing-primary branch: the reconcile embeds that query.
        if (text.startsWith("UPDATE jobs")) {
          return { rows: Array.from({ length: o.reconciled }, (_, i) => ({ id: i + 1 })) };
        }
        if (text.includes("FROM pg_proc")) return { rows: [{ count: o.functionExists ? 1 : 0 }] };
        if (text.includes("FROM pg_trigger")) return { rows: [{ count: o.triggerEnabled ? 1 : 0 }] };
        if (text.includes("LEFT JOIN schedule_entries")) return { rows: [{ count: o.missingPrimary }] };
        if (text.includes("FROM jobs")) return { rows: [{ count: o.jobs }] };
        return { rows: [] };
      },
    },
  };
}

test("the checksum is derived from the SQL, not hand-written", () => {
  assert.match(CALENDAR_ENTRY_SYNC_V1_CHECKSUM, /^[0-9a-f]{64}$/);
  assert.equal(migration.checksum, CALENDAR_ENTRY_SYNC_V1_CHECKSUM);
  assert.equal(CALENDAR_ENTRY_SYNC_V1_ID, "calendar_entry_sync_v1");
  assert.equal(migration.required, true);
});

test("apply installs the function, then the trigger, then reconciles", async () => {
  const context = fakeContext({ reconciled: 3 });
  const result = await migration.apply(context, await migration.preflight(context));
  const fn = context.calls.findIndex((s: string) => s.startsWith("CREATE OR REPLACE FUNCTION"));
  const trigger = context.calls.findIndex((s: string) => s.includes("CREATE TRIGGER"));
  const reconcile = context.calls.findIndex((s: string) => s.startsWith("UPDATE jobs"));
  assert.ok(fn >= 0 && fn < trigger && trigger < reconcile, "wrong order");
  assert.equal(result.reconciledJobs, 3);
});

test("the trigger fires on inserts and on scheduling columns only", () => {
  assert.match(SYNC_TRIGGER_SQL, /AFTER INSERT OR UPDATE OF scheduled_date, scheduled_start_time, scheduled_end_time, status, total_amount, estimated_duration, recurring_plan_id/);
  // A note or crew edit must not rewrite the entry.
  assert.ok(!/UPDATE OF[^\n]*\bnotes\b/.test(SYNC_TRIGGER_SQL));
  assert.ok(!/UPDATE OF[^\n]*\bcrew_id\b/.test(SYNC_TRIGGER_SQL));
  assert.match(SYNC_TRIGGER_SQL, /FOR EACH ROW/);
});

test("re-running the trigger definition is safe", () => {
  assert.match(SYNC_TRIGGER_SQL, /^DROP TRIGGER IF EXISTS jobs_sync_primary_schedule_entry ON jobs;/);
  assert.match(SYNC_FUNCTION_SQL, /^CREATE OR REPLACE FUNCTION/);
});

test("a held entry is checked before the queue, so holding cannot bounce back", () => {
  const hold = SYNC_FUNCTION_SQL.indexOf("entry.status = 'on_hold'");
  const queued = SYNC_FUNCTION_SQL.indexOf("next_status := 'queued'");
  assert.ok(hold > 0 && hold < queued, "on_hold must be decided before queued");
  // And the hold keeps its reason and waiting status.
  assert.match(SYNC_FUNCTION_SQL, /WHEN next_status = 'on_hold' THEN entry\.queue_status/);
  assert.match(SYNC_FUNCTION_SQL, /on_hold_reason\s+= CASE WHEN next_status IN \('on_hold', 'canceled'\) THEN entry\.on_hold_reason END/);
});

test("cancellation wins over everything, including a date", () => {
  const cancel = SYNC_FUNCTION_SQL.indexOf("next_status := 'canceled'");
  const scheduled = SYNC_FUNCTION_SQL.indexOf("next_status := 'scheduled'");
  assert.ok(cancel > 0 && cancel < scheduled);
  assert.match(SYNC_FUNCTION_SQL, /IN \('canceled', 'cancelled'\)/);
});

test("a queued entry keeps a waiting reason someone already set", () => {
  assert.match(SYNC_FUNCTION_SQL, /COALESCE\(entry\.queue_status, 'needs_contact'\)/);
});

test("scheduled and cancelled entries carry no waiting reason, per the scope constraint", () => {
  // The CASE has branches only for queued and on_hold, so anything else is NULL.
  const queueCase = SYNC_FUNCTION_SQL.slice(
    SYNC_FUNCTION_SQL.indexOf("queue_status            = CASE"),
    SYNC_FUNCTION_SQL.indexOf("on_hold_reason          ="),
  );
  assert.ok(!/ELSE/.test(queueCase), "an ELSE would give scheduled work a waiting reason");
});

test("new entries are primary, carry the whole value, and say who wrote them", () => {
  assert.match(SYNC_FUNCTION_SQL, /NEW\.id, 1, true, job_date/);
  assert.match(SYNC_FUNCTION_SQL, /ROUND\(NEW\.total_amount \* 100\)/);
  assert.match(SYNC_FUNCTION_SQL, /'trigger:sync_primary_schedule_entry'/);
});

test("malformed legacy dates and times read as absent instead of failing the job write", () => {
  assert.match(SYNC_FUNCTION_SQL, /CASE WHEN NEW\.scheduled_date ~ '\^\[0-9\]\{4\}/);
  assert.match(SYNC_FUNCTION_SQL, /CASE WHEN NEW\.scheduled_start_time ~/);
});

test("an undated cancelled job gets no new entry, matching both backfills", () => {
  assert.match(SYNC_FUNCTION_SQL, /IF next_status = 'canceled' AND job_date IS NULL THEN\s+RETURN NEW;/);
});

test("reconciliation fires the trigger rather than repeating the mapping", async () => {
  const context = fakeContext();
  await migration.apply(context, await migration.preflight(context));
  const reconcile = context.calls.find((s: string) => s.startsWith("UPDATE jobs"));
  assert.match(reconcile, /SET status = status WHERE id IN/);
  assert.ok(!context.calls.some((s: string) => s.startsWith("INSERT INTO schedule_entries")));
});

test("postflight fails when any job is still missing its entry", async () => {
  const preflight = await migration.preflight(fakeContext());
  await assert.rejects(
    () => migration.postflight(fakeContext({ missingPrimary: 2 }), preflight),
    /postflight failed/,
  );
});

test("postflight fails when the function or trigger did not land", async () => {
  const preflight = await migration.preflight(fakeContext());
  for (const broken of [{ functionExists: false }, { triggerEnabled: false }]) {
    await assert.rejects(() => migration.postflight(fakeContext(broken), preflight), /postflight failed/);
  }
});

test("postflight fails if jobs were added or removed underneath it", async () => {
  const preflight = await migration.preflight(fakeContext({ jobs: 5 }));
  await assert.rejects(
    () => migration.postflight(fakeContext({ jobs: 6 }), preflight),
    /must not add or remove jobs/,
  );
});

test("verify passes on a healthy database and reports what it checked", async () => {
  const result = await migration.verify(fakeContext());
  assert.deepEqual(result, { jobs: 5, missingPrimary: 0, functionExists: true, triggerEnabled: true });
});

test("rollback removes the trigger and function but never the entries", async () => {
  const context = fakeContext();
  const result = await migration.rollback(context);
  assert.equal(result.entriesRemoved, 0);
  assert.ok(context.calls.some((s: string) => s.includes("DROP TRIGGER IF EXISTS jobs_sync_primary_schedule_entry")));
  assert.ok(context.calls.some((s: string) => s.includes("DROP FUNCTION IF EXISTS sync_primary_schedule_entry()")));
  assert.ok(!context.calls.some((s: string) => s.includes("DELETE")));
});
