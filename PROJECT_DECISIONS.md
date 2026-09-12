# Project decisions and working context

**Last updated:** 2026-09-07

## How to use this file

This is the running memory for work on this repo. It exists so that a lost chat, a new
machine, or a fresh session can pick up without re-deriving anything.

Read it before starting work. Update it whenever:

- The user makes a decision
- A recommendation is made and accepted or rejected
- Work is parked, and why
- We start waiting on the client for something, or an answer arrives

Keep it factual. Everything here should trace to something actually verified in the repo, not
assumed. Where something is unverified, say so explicitly.

**Read this alongside `.agents/memory/project-architecture-map.md`.** The two divide cleanly
and neither replaces the other: that file maps the repository as built — topology, runtime and
data flows, library choices, verification baseline, technical risks. This file carries the
decisions, the roadmap, and what we are waiting on people for. When they disagree about a
technical fact, the architecture map was measured more recently; when they disagree about a
decision or its reasoning, this file is the record.

`.agents/memory/MEMORY.md` indexes the other agent-memory notes, several of which capture real
traps (Radix Select pitfalls, advisory lock namespaces, the convert-core adapter pattern).
Worth a look before touching those areas.

---

## Where things stand right now — read this first

**As of 2026-09-11.** Everything below this section is detail; this is the state of play.

**The work:** building the calendar described in the Corstead spec (v1.0, 31 Aug 2026). Of its
34 V1 items, **6 are done, 10 partial, 18 not started**. Only 1 of the spec's 5 prototype tests
passes. The sequencing plan is the Roadmap section.

**What is in flight:**

| | State |
|---|---|
| **Step 1 — the four calendar tables** | Committed (`a8a245e`) and **live on the Neon development branch** — 75 tables, constraints proven by test. Not on production, and the backfill migration has not run anywhere |
| **Step 2 — Scheduling Queue and On Hold** | **Complete** — API committed (`e64476d`), three-tab UI built 2026-09-11 and uncommitted. None of it has run against a real database yet |
| **Database move to Neon** | Recreated in `us-west-2` on 2026-09-11, schema pushed and constraints re-proven. Development is usable now; production is empty and untouched |
| **Notify-before-send** | Parked deliberately. Investigated and planned, not built |

**The immediate next actions, in order:**

1. Point the Replit **development** environment at the Neon dev branch (`DATABASE_URL`), and
   set `APP_MIGRATIONS_ENABLED = "true"` so the backfill migrations run there. Everything else
   waits on this — the queue endpoints have never run against a real database
2. Verify Step 2 end to end once the database is connected — the queue has never met a real
   row. It unlocks two prototype tests
3. Fix the migration gate to allow a production environment — required before any cutover
4. Move Neon project ownership to Lute; he asked for it, and the account was created on our side

**The single most important constraint:** Lute wants no interruption to Kyle's testing. Do not
let the database move stall the feature build.

**Do not** run `git commit` or `git push` — hand the user the message to paste.

---

## Project shape

Corstead CRM for a window-cleaning business, imported from a Replit project.

- pnpm workspace. Packages: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`
- `artifacts/crm` — React 19 + Vite frontend
- `artifacts/api-server` — Express API
- `lib/db` — Drizzle schema, one file per table under `lib/db/src/schema/`
- `lib/api-spec/openapi.yaml` — hand-written OpenAPI 3.1, the API contract
- `lib/api-client-react`, `lib/api-zod` — **generated** by orval from that spec. Never
  hand-edit anything under `src/generated/`

**Single-tenant.** `routes/auth.ts:72` hardcodes `TENANT_ID = "single-tenant"` and
`lib/idempotency.ts:27-31` states there is no account/organization concept yet. Relevant
because the spec (§17) warns this is heading toward SaaS.

There is **no `CLAUDE.md`** in this repo. This file is the substitute.

### Key commands

| Purpose | Command |
|---|---|
| Regenerate API client after editing `openapi.yaml` | `pnpm --filter @workspace/api-spec codegen` |
| Apply schema changes | `pnpm --filter @workspace/db run push` |
| Typecheck | `pnpm typecheck` (root) |
| API tests | `pnpm --filter @workspace/api-server test` |
| CRM tests | `pnpm --filter @workspace/crm test` |

Tests use `node:test` with `--experimental-strip-types`. **New test files are not discovered
automatically** — each must be added by path to the `test` script in the relevant
`package.json`.

---

## The Corstead calendar specification

Internal product spec **v1.0, dated 31 Aug 2026**, "Calendar Functional and UX
Specification". Builds a modernised functional equivalent of a reference calendar
(thecustomerfactor.com), not a pixel copy.

Its own approval gate (§18): *"Approve the clickable calendar prototype before building full
backend logic."* Responsible: Lute Atieh. Reviewers: Kyle Stafford and Emberlynn.

### V1 readiness as of 2026-09-04

Audited at commit `3e4c71c`. **6 done / 10 partial / 18 not started** out of the 34 V1 items.

Published audit: https://claude.ai/code/artifact/7adbd4b3-79f3-4b86-bade-21d4f9407018

**Done:** month view, adjacent-month spill days, drag one job to another date, invoice-status
colours, completed-job display, undo.

**Built and solid:** bounded calendar reads (`GET /calendar/occurrences`, `/calendar/totals` —
totals summed in the DB, one row per day, so a busy month costs what a quiet one does),
`lib/calendar-drag.ts` (preserves time on a month move, per spec §3.2), `lib/crew-overlap.ts`
(satisfies acceptance test 7), `lib/schedule-change-lock.ts` (refuses to move completed or
invoiced work).

**Of the spec's five prototype tests (§18), only one passes today** — "reschedule one
customer". The other four need the scheduling queue, move-entire-day, filters, and bulk
invoicing.

Note: the spec's gate said prototype approval should come *before* full backend logic, but
backend logic was already built. That is a deviation worth being deliberate about.

### Four architectural blockers

The month grid was built on the existing `jobs` table, and the spec's §11 data model cannot be
expressed in that schema. These gate roughly half the remaining V1 list, and should be settled
**before** more calendar UI is written.

| Spec | Missing | Blocks |
|---|---|---|
| §11.2 | `schedule_entries` table | Schedule is inline on `jobs` (`scheduledDate`, `scheduledStartTime`, `scheduledEndTime`), so **one job = one date**. Blocks on-hold, multi-day jobs, daily value allocation (§7.19), unique-job counting (§9.2), move entire day, recurring exceptions |
| §11.3 | Assignment link table | Only one `crewId` + one `assignedTechnicianUserId`. Blocks multiple assignments, crew subtotals, grouped display, separate crew lanes, the §9.4 "counts once" rule |
| §11.4 | Shared calendar-event table | No home for estimate/prospect/personal appointments, scheduling blocks, holidays, birthdays. Spec is explicit these must not be fake jobs. A `tasks` table exists but is not wired to the calendar |
| §11.6 | `calendar_preferences` | Every filter and display setting resets on reload. Spec lists 18 preferences to persist per user |

The spec's own warning (§17) applies here first: *"calculation rules must be defined before
totals are coded."*

---

## Roadmap — remaining calendar work, in order

**28 items pending** (10 partial + 18 not started). Sequenced around the spec's own approval
gate (§18): get the five prototype tests passing first — only one passes today — then finish
the rest of V1.

### Phase A — reach the approval gate

| Step | Work | V1 items | Unlocks |
|---|---|---|---|
| 1 | **Data model — the four blocker tables** | foundation for #14, #15 | everything else |
| 2 | Scheduling Queue + On Hold | #7, #8, #10, #25 | prototype test 1 |
| 3 | Filters + job side drawer | #16, #17, #21, #24 | prototype test 4 |
| 4 | Move Entire Day + scheduling blocks + fuller conflict validation | #11, #12, #34 | prototype test 3 |
| 5 | Bulk invoice creation with review | #26 | prototype test 5 |

Then take it to Lute Atieh, with Kyle Stafford and Emberlynn reviewing. The spec is explicit
that no further calendar complexity is approved until the five tasks are fast and need
minimal training.

### Phase B — the rest of V1

| Step | Work | V1 items |
|---|---|---|
| 6 | Weekly and monthly totals, monthly summary block (§5.5) | #19, #20 |
| 7 | Recurring: this-occurrence vs entire-series prompt, with exception records | #13 |
| 8 | Week View as a real 30-minute time grid; navigation dropdowns, sticky toolbar, week start setting | #2, #4, #5 |
| 9 | Quick Add | #6 |
| 10 | Appointment-card field customization + per-user saved preferences | #18, #30 |
| 11 | Print calendar, PDF output, CSV appointment export | #27, #28, #29 |
| 12 | Permissions (pricing visibility split) + audit logging of calendar moves | #31, #32 |
| 13 | The parked notify-before-send work (see above) | — |

### Step 1 progress — started 2026-09-05

Written, **not yet applied to any database**:

| File | What |
|---|---|
| `lib/db/src/schema/schedule_entries.ts` | One row per day a job is worked. `status` includes `queued`, so the scheduling queue is a query on this table rather than a separate one |
| `lib/db/src/schema/schedule_assignments.ts` | Many assignments per day. Three typed columns (`crew_id` / `user_id` / `queue_key`) with a check that exactly the one matching `assignment_type` is filled, instead of a polymorphic id |
| `lib/db/src/schema/calendar_events.ts` | Blocks, tasks, personal appointments, holidays, birthdays — deliberately not fake jobs |
| `lib/db/src/schema/calendar_preferences.ts` | 13 scalar columns plus `list_settings` jsonb for the five list-shaped preferences |
| `artifacts/api-server/src/migrations/calendar-schedule-entries-v1.ts` | Creates the four tables idempotently and backfills one primary entry per dated job |
| `artifacts/api-server/src/migrations/calendar-schedule-entries-v1.test.ts` | 14 tests, all passing |

Committed as `a8a245e`. The monthly-totals fix that followed is `bc8f651`.

Registered in `lib/db/src/schema/index.ts`, in `REQUIRED_MIGRATIONS`, and in the api-server
`test` script.

**Decisions taken here:**
- `jobs.scheduled_date` stays as a mirror of the primary entry (dual-write), following the
  precedent set by `crew_members` against the legacy text on `crews`
- Money is whole cents in `allocated_value_cents`, held as `numeric(18,0)` — see the startup
  note below for why an integer would have been a bug
- The migration creates the tables as well as backfilling, so production does not depend on
  the development-only `drizzle-kit push` path
- Full §11.5 recurrence-series exceptions are **not** built here. `schedule_entries` carries
  `recurring_plan_id` and `occurrence_key` so Step 7 can add them without a second migration

**Verified on 2026-09-05:** full workspace typecheck passes across all four projects; the
migration's 17 tests pass along with the 11 migration-runner tests. Test counts match the
known baseline below, so nothing here regressed anything.

#### ⚠️ This migration runs at server startup

`artifacts/api-server/src/index.ts:29` awaits `runRequiredMigrationsAtStartup(pool)` **before**
`app.listen`, and this migration is `required: true` in `REQUIRED_MIGRATIONS`. So on Replit it
runs on the next boot after the code is pulled, and **if it throws, the server does not
start.** The gate in `evaluateMigrationGate` decides which of three things happens:

| Environment | Result |
|---|---|
| `APP_MIGRATIONS_ENABLED` not `"true"` | Skipped silently. Server boots, **tables are never created** |
| Enabled, but environment is not `sandbox` or the Repl identity does not match | **Throws — server will not start** |
| Enabled, `APP_MIGRATION_ENVIRONMENT=sandbox`, and `REPL_ID` matches `APP_MIGRATION_SANDBOX_REPL_ID` (or `REPLIT_DOMAINS` matches `APP_MIGRATION_SANDBOX_DOMAIN`) | Runs, then the ledger makes it a no-op on later boots |

Because a failure here is a failed boot rather than a failed command, two things were changed
after the first draft, both found by reading what the live data can actually contain:

- **`allocated_value_cents` is `numeric(18,0)`, not `integer`.** `jobs.total_amount` is
  `numeric(10,2)` and so reaches 9,999,999,999 cents — nearly five times an int4's limit. One
  large job would have aborted the migration. This also matches the existing cents convention,
  `financial_approval_policies.threshold_cents`.
- **Time checks accept optional seconds.** The API has always taken `HH:mm` *and* `HH:mm:ss`,
  so job rows carry both shapes; an `HH:mm`-only check would have rejected real data.

`preflight` also counts jobs that could not become a valid entry — malformed date or time,
negative amount, negative duration — and refuses with a sentence naming the problem, rather
than letting Postgres raise a bare constraint name during boot.

**Still to do for Step 1 — needs a database, which this machine does not have.**

The working arrangement (agreed 2026-09-05): code is written locally, the user pulls it into
Replit, and it runs against the Replit database. A separate database is planned later, not now.
So anything schema-related has to be correct *before* it is pulled — there is no local database
to try it against.

On Replit, after pulling:

1. Confirm the gate env vars are set, or the migration is silently skipped and no table appears
2. Restart the server — the startup gate applies it — or run it explicitly:
   `pnpm --filter @workspace/api-server run migration:run -- calendar_schedule_entries_v1`
3. `pnpm --filter @workspace/api-server run migration:verify -- calendar_schedule_entries_v1`
   to confirm every dated job received a primary entry

`drizzle-kit push` is optional here: the migration creates the tables itself, precisely so
production does not depend on the development-only push path. Run push only to keep a dev
database in step with the TypeScript schema.

**No table has been created and no row has been written yet.**

### Step 2 progress — started 2026-09-10

Foundation laid, built to the layering agreed in the Architecture section since this is all new
code. Applied to the Neon development branch and verified there.

| File | What |
|---|---|
| `artifacts/api-server/src/lib/schedule-queue-core.ts` | Pure rules — the seven §4.3 waiting reasons, bounded page parsing, keyset cursors, hold/release decisions, days-waiting. No database, no I/O |
| `artifacts/api-server/src/lib/schedule-queue-core.test.ts` | 21 tests |
| `lib/db/src/schema/schedule_entries.ts` | Added `queue_status`, two check constraints, and the `(status, created_at, id)` queue index |
| `artifacts/api-server/src/migrations/calendar-queue-entries-v1.ts` | Adds that column and index, and backfills queued entries for undated open jobs |
| `artifacts/api-server/src/migrations/calendar-queue-entries-v1.test.ts` | 13 tests |

Suite: 444 tests, 429 pass; the 15 failures are the known `DATABASE_URL` baseline.

**Two gaps in Step 1 that this closes:**

1. `calendar_schedule_entries_v1` backfilled only *dated* jobs, leaving undated ones — exactly
   the "Ready to Schedule" work — with no entry at all.
2. The seven §4.3 waiting reasons had nowhere to live. `on_hold_reason` is free text; these are
   a fixed set, so they get their own constrained column.

**Why a second migration rather than editing the first:** the framework checksums each
definition and refuses drift, so a changed checksum requires a new id.

**Design decisions worth keeping:**

- `queue_status` is deliberately separate from `status`. `status` says *where* work sits
  (queued / scheduled / on_hold / canceled); `queue_status` says *why* it is still sitting
  there. A constraint enforces that only queued or held work carries one.
- **Keyset pagination, not offset.** The queue reorders as people work it — scheduling a job
  from page one shifts everything after it, and `OFFSET` would silently skip a row. Cursors
  carry `(queued_at, id)` so ties cannot skip either.
- **Bounded reads from the start**, following `calendar-range.ts`: 100 rows per page maximum.
  Note that the existing `GET /jobs/unscheduled` and `GET /recurring-plans/due` are **not**
  bounded — they return every row. Worth fixing when the queue replaces them.
- `enrichJobs` (`routes/jobs.ts:228`) is not N+1 — it batches with `inArray`, five queries
  regardless of job count. Reusable as-is.

**Verified against the Neon development branch**, not just in tests: an invented waiting reason
is rejected, and a waiting reason on scheduled work is rejected by the scope constraint.

#### API layer — built 2026-09-11

The full stack below the UI now exists, in the layering agreed on 2026-09-07. **474 tests, 460
pass, 14 fail** — the fails are the known `DATABASE_URL` baseline, and there is one fewer of
them than before (see the `@workspace/db/schema` note below).

| File | Holds | Tests |
|---|---|---|
| `lib/schedule-queue-core.ts` | Decisions, cursors, page shaping. No I/O | 45 |
| `lib/schedule-queue-scope.ts` | Who sees which rows, and whether money | 3 |
| `repositories/schedule-entry.ts` | Drizzle/SQL only, no rules | via the real DB |
| `services/schedule-queue.ts` | Transactions, `jobs` mirroring, audit trail | via the real DB |
| `routes/schedule-queue.ts` | Parse, authorize, respond | — |

**Endpoints:** `GET /schedule-queue?tab=ready|on_hold&limit=&cursor=&status=`,
`GET /schedule-queue/statuses`, `POST /schedule-queue/:id/{schedule,hold,release}`,
`PATCH /schedule-queue/:id/status`.

**Decisions made while building, worth not re-deriving:**

- **Every transition re-reads under `FOR UPDATE` inside its own transaction.** The unlocked read
  says whether the request is worth attempting; the locked one says whether it is still true.
  Without it two browsers acting on the same card both pass the check and the second write wins
  silently.
- **400 versus 409 is load-bearing.** A malformed request is 400 ("fix your input"); a
  well-formed request against the wrong state is 409 ("someone else moved this, reload"). The UI
  branches on the `code` field.
- **Holding preserves the date** in `original_scheduled_date` and clears `jobs.scheduled_date`,
  so held work stops painting on the calendar through the legacy mirror column.
- **Scheduling clears `queue_status`**, because the scope constraint allows a waiting reason only
  off the calendar.
- **Counts come from their own grouped query**, not from the page. A page is 100 rows; the filter
  chips describe the whole tab.
- **`field_tech` can read the queue but not move work through it** — `schedule.view` yes,
  `schedule.manage` no. So the scoping predicate is live, not dead code: a tech sees only
  assigned work and no amounts. Locked down by test. Note the real role name is `field_tech`,
  **not** `field_technician`; `hasCapability` on an unknown role silently returns false, which
  makes a typo look like a passing authorization test.
- **`/schedule-queue` does not match the `/schedule` prefix rule** (`matchesPrefix` needs an
  exact match or a trailing slash), so it has its own rules. Asserted by test, because if that
  ever changed the POSTs would fall through to no capability at all.

**Incidental fix:** `lib/field-tech-scope.ts` imported `@workspace/db`, whose root opens a
connection pool at import time — so every module building a predicate from it was untestable
without a live database, including its own test. Now imports `@workspace/db/schema`. That is the
14th failure gone, and the pattern to copy elsewhere.

#### UI layer — built 2026-09-11

**373 CRM tests, all passing.** Typecheck clean.

| File | Holds |
|---|---|
| `crm/src/lib/schedule-queue-view.ts` | Labels, waiting badges, chips, page accumulation. No fetch, no React |
| `crm/src/lib/schedule-queue-view.test.ts` | 22 tests |
| `crm/src/lib/schedule-queue-api.ts` | Hand-written client, same pattern as `calendar-api.ts` |
| `crm/src/components/SchedulingQueue.tsx` | The three tabs, cards, filter chips, schedule/hold dialogs |
| `crm/src/pages/Schedule.tsx` | Renders the queue; the old panels became a fallback |

**Decisions worth keeping:**

- **The queue supersedes two older panels** — "Needs Scheduling" and "Due for Service" — but both
  are still rendered *when the queue endpoint fails server-side*. The backfill runs at server
  startup, so between deploying this build and setting `APP_MIGRATIONS_ENABLED = "true"` there is
  a window where the queue has no table to read. The office must not be left with nothing. A 4xx
  does **not** trigger the fallback: that would be our bug, not a missing table. Delete the
  fallback once the queue has run in production for a while.
- **"Repeat Service Due" is passed in, not fetched by the queue.** A plan that is due has not
  produced a job yet, so there is no `schedule_entries` row to read. The grid was extracted to
  `DueForServiceGrid` so the tab and the fallback panel render the same cards.
- **Filter chips keep the canonical reason order, not count order.** A list that reorders as work
  moves through it is hard to click twice — the chip you wanted has moved.
- **`appendPage` de-duplicates on entry id.** React strict mode double-invokes effects, which
  makes a duplicated page easy to write and nearly invisible: the list just grows with repeats.
  It also returns the same array when nothing is new, so React skips a render.
- **A hidden amount renders as nothing, never `$0.00`.** Field techs receive `null`; a zero would
  claim the job is free.
- **A filtered-empty tab does not say "the queue is clear"** — that would be untrue with a filter
  on.

**Incidental fix:** `crm/src/lib/auth-scope.test.ts` — the raw-fetch security audit could not run
on Windows at all. `URL.pathname` yields `/E:/…`, which resolves against the current drive as
`E:\E:\…`; and the assertion compared POSIX paths that Windows can never produce. Now uses
`fileURLToPath` and normalizes separators. An audit that cannot run protects nothing.

**⚠️ `npx vite build` fails on this machine** — `@rollup/rollup-win32-x64-msvc` is missing from
`node_modules`, the same broken-install problem recorded under environment gotchas. Not a code
defect; it builds on Replit. Typecheck and the test suite are the signal here.

**Still to do for Step 2:** none of this has run against a real database. That happens when
Replit points at Neon and migrations are enabled.

### Detailed breakdown — what each step contains

Spec section references in brackets. Items marked DONE are already built and must not be redone.

**Step 1 — Data model**
- `schedule_entries` [11.2] — job ID, start/end date+time, no-specific-time flag, all-day flag,
  duration, schedule status, primary-occurrence flag, multi-day segment number, allocated job
  value, recurrence-occurrence ID, rescheduled count, original scheduled date, on-hold reason,
  callback date, created/updated by + timestamps
- Assignment link [11.3] — schedule-entry ID, assignment type (Employee/Crew/Queue), assignment
  ID, primary yes/no, value-allocation percentage, planned hours
- Shared calendar-event table [11.4] — estimate appointments, prospect appointments, tasks,
  personal appointments, scheduling blocks, holidays, employee birthdays. Explicitly **not**
  fake jobs. Wire the existing `tasks` table in
- `calendar_preferences` [11.6] — 18 per-user settings: default view, last viewed date, week
  start, Sunday visibility, selected appointment types, selected assignments, grouped/separate,
  displayed card fields, total settings, invoice-status display, completed-job visibility,
  holiday visibility, birthday visibility, colour mode, expanded sidebar sections, sidebar
  order, sidebar open/closed
- Recurrence series gaps [11.5] — `recurring_plans` exists but has no series exceptions,
  cancelled occurrences, or rescheduled occurrences
- Audit record [11.7] — action, old value, new value, reason, whether the customer was
  notified, bulk-operation ID

**Step 2 — Scheduling Queue + On Hold [4]**
- One queue, three tabs: Ready to Schedule, On Hold, Repeat Service Due [4.1]
- Queue card: 13 fields incl. days waiting, preferred crew, last contact, next callback,
  on-hold reason [4.2]
- Seven named statuses replacing abbreviations — Needs Contact, Contacted, Callback Scheduled,
  Waiting on Customer, Waiting on Materials, Weather Hold, Ready to Schedule [4.3]
- Eleven queue actions incl. call, email, text, record contact attempt, set callback [4.4]
- Drag queue to calendar: 7-step flow with a compact scheduling panel, then recalculate totals
  and show undo [4.5]
- Drag calendar to On Hold: 8-step flow. Reason required, optional callback date, recurring
  occurrence-or-series prompt, job is **preserved not cancelled** [4.6]

**Step 3 — Filters + job drawer [7, 6.7, 2.3]**
- Left settings panel: collapsible, remembers open/closed per user, per-section expand state,
  Reset Filters, active-filter count, updates with no page reload [2.3]
- WARNING — By Appointment Type [7.2]: the reference list mixes seven different data types.
  **Do not hard-code as one DB field.** Customer type / recurrence / frequency / classification
  tag / event type / job status / assignment status stay separate underneath, however the UI
  presents them
- Filters always multi-select; "Only This Type" shortcut on hover. No Single/Multiple mode [7.3]
- By Assignment — populated dynamically from active employees, crews, queues. **Never
  hard-code crew or employee names** [7.4, 7.5]
- Grouped vs Separate assignment display; cap Separate in Month View around four [7.6]
- Invoice status filter [7.7] — colours DONE
- Jobs Completed show/hide; totals must state whether hidden completed jobs are excluded [7.8]
- Job totals settings: Gross vs Net, define both explicitly [7.9]
- Number of jobs daily — exclude tasks, personal appointments, blocks, holidays, birthdays,
  cancelled jobs [7.10]
- Job side drawer: 11 actions — open customer, open job, edit date/time, reassign crew, mark
  complete, create/view invoice, call/text/email, add note, put on hold, copy, cancel [6.7]
- Hover details: full name, service address, phone, service type, time+duration, assignment,
  value, invoice status, notes indicator [6.7]

**Step 4 — Move Entire Day, blocks, validation [8.2, 7.15, 7.21, 8.3-8.5]**
- Move Entire Day: 11-step flow — drag the date header, review affected jobs, choose what
  moves, conflict validation, recurring resolution, bulk notification review list, undo [8.2]
- Scheduling blocks: full-day in Month View, time-range in Week View; scoped to company, crew,
  employee or several; reason required; hard blocks reject drops, soft blocks warn [7.15]
- Drag and drop validation — 12 rules incl. overlapping assignments, hard blocks, appointment
  limits, daily hours, employee unavailable, outside business hours, past date, completed,
  invoiced, reason required, recurring selection, notification decision [7.21].
  Crew overlap and completed/invoiced locks are DONE
- Copy appointment — copies customer, address, service lines, notes, preferred crew; **never**
  invoice, payment, completion status, signature, actual time [8.3]
- Reorder No-Specific-Time jobs within a day [8.4]
- WARNING — critical protections must not be disableable by an ordinary user [7.21]

**Step 5 — Bulk invoice creation [13.1]**
- 8-step flow: show completed uninvoiced jobs in range, select all or individual, warn about
  jobs not marked complete, preview totals, create, update colours. Duplicate protection —
  ignore jobs that already have invoices

**Step 6 — Totals [9, 5.3, 5.4, 5.5]**
- Day footer: job count, scheduled value, duration, crew subtotals, completed count [5.3]
- Weekly total — **not** placed only inside Sunday's cell, since Sunday can be hidden [5.4]
- Monthly summary: scheduled jobs, open estimates, on-hold, completed, uninvoiced — five rows,
  recalculating with active filters [5.5]
- WARNING — terminology: call it **Scheduled Job Value**, never "Sales" [9.1]
- Unique job counting — one job counts once despite multiple dates, crews, or segments [9.2]
- Daily allocation for multi-day jobs [9.3] — **decided: full value on the first scheduled
  day, later days zero.** Monthly reporting uses the same anchor, so a job may report in a
  month in which some of its work is not performed
- Multiple crews: one primary, company counts once, primary crew gets the value [9.4]
- On-hold value shown separately from scheduled value [9.5]
- Cancelled jobs excluded from counts and value, still in history [9.6]
- Filtered totals must state that they are filtered [9.7]

**Step 7 — Recurring occurrence vs series [7.16]**
- Moving, editing, cancelling or holding recurring work asks: this occurrence only, or the
  entire series. Needs the exception records from step 1

**Step 8 — Week View, navigation [3.2, 3.4, 3.5, 7.12]**
- Week View as a real time grid: 30-minute rows, vertical drag changes time, horizontal drag
  changes day, all-day and No Specific Time sections at top, crew conflicts shown, optional
  per-crew lanes [3.2]
- Navigation: prev/next, month dropdown, year dropdown, Today, Week, Month, optional Day,
  Sunday-start or Monday-start [3.4]
- Sticky toolbar while scrolling — a recommended improvement over the reference, which repeats
  navigation at the bottom
- Jump to Current Date on/off; when off, remember the last viewed range for the session [3.5]
- Sunday show/hide, warn if Sunday has appointments, state whether weekly totals include
  hidden Sunday work [7.12]

**Step 9 — Quick Add [10.2]**
- Search existing customer or prospect by name/phone/email/address, pick record, choose Job /
  Estimate Appointment / Prospect Appointment / Task / Personal Appointment / Scheduling Block,
  confirm service location, date, time, duration, assignment, service type, value, save,
  calendar updates immediately

**Step 10 — Card customization + preferences [6.3, 6.4, 6.5, 6.6, 11.6]**
- Fixed fields: time, customer or business name, status badge. Everything else optional [6.3]
- Residential default is last name; commercial default is business name [6.4]
- Always show the **service** address, not the billing address; hover identifies both when
  they differ [6.5]
- Long text truncates with ellipsis, full value on hover, never overflows into another cell [6.6]
- Live preview in display settings; do not let users make cards unreadable
- Persist all 18 preferences per user [11.6]

**Step 11 — Print, PDF, CSV [13.2, 13.3, 13.4]**
- Print monthly calendar: landscape, no navigation or sidebar, preserve filters, pricing
  optional, repeat weekday headings across pages, never clip rows
- PDF variants: calendar only / with totals / with or without pricing / one crew or all /
  include or exclude personal appointments and tasks
- CSV appointment export: 18 columns. WARNING — print layouts must be designed and tested
  separately from the browser layout [17]

**Step 12 — Permissions + audit [12, 11.7]**
- Four roles: Administrator/Owner, Office Scheduler, Crew Leader, Technician
- Financial totals, payment information, customer personal information and personal
  appointments must all be permission controlled
- Every move, assignment change, hold, cancellation and bulk operation appears in audit history

**Step 13 — Parked notify-before-send work** — see the section below

### Definition of done

Spec §16 lists **23 acceptance tests**. Those are the real completion bar, not the item list.
Two are already satisfied: the crew-overlap warning before a conflicting move (test 7) and,
partially, invoice colour transitions (test 11).

Two are easy to overlook and worth designing for early:
- Test 15 — active employee and crew filters come from company records and are **not hard-coded**
- Test 23 — two office users cannot silently overwrite each other's schedule changes. Needs
  record versioning or conflict detection [17]

### ✅ Step 1 is unblocked — value allocation answered

**Answered by Kyle Stafford on 2026-09-05: Option A — full value on the first scheduled day.**

His exact words: *"We want the job pricing on the first day of the job scheduled. The same
with monthly reporting. If the job is scheduled in August and runs into September, the pricing
for the job would be on the August reporting."*

This settles §7.18, §7.19 and §9.3 together. The rules that follow:

1. **Daily value** — the job's whole value lands on its first scheduled day. Later segments of
   the same job carry zero value. A Monday–Tuesday job worth $1,200 shows $1,200 on Monday and
   $0 on Tuesday.
2. **Monthly reporting follows the same anchor, not the segment dates.** A job starting
   28 August and finishing 2 September reports entirely in **August**. This is a stronger
   statement than daily allocation alone, and it applies to the monthly summary (§5.5) and to
   any period reporting built on scheduled value.
3. **Duration is unaffected.** Only money is anchored to the first day. Scheduled hours still
   belong to the day they are actually worked, so crew capacity and the duration totals in
   §7.20 stay honest.

**Schema consequence:** `schedule_entries` still carries a per-entry `allocatedValue` column,
populated as full-value-on-primary / zero-on-the-rest, plus the `primaryOccurrenceFlag` that
identifies the anchor day. Storing it per entry rather than deriving it keeps the switch to
duration-split a small change when the V1.1 allocation setting arrives (§15.2 lists
"multi-day value allocation" as V1.1), rather than a rebuild.

**Watch for:** monthly attribution by anchor day means a month's scheduled value can include
work physically performed in the next month. Any query that sums scheduled value by month must
join through the primary entry, not filter segment dates by range. Cross-check against the
existing reporting rules recorded in `.agents/memory/dashboard-reporting-semantics.md` before
wiring the monthly summary.

---

## PARKED — Notify the customer before sending on a schedule change

**Status: investigated and planned, not implemented. Parked by the user on 2026-09-04.**

### The problem

When a job's scheduled **date** changes, `routes/jobs.ts:1033` enqueues a communication event
inside the update transaction. A background dispatcher picks it up within 30s and, if an
active automation rule matches, queues a real email. Nobody is asked.

Nudge a card by accident on the month calendar and the date change is undoable, but the
customer message is not. The customer gets two conflicting messages and calls the office.

Spec §8.6 says the opposite: do not send merely because a user dragged a job. Ask, show the
message, allow editing, record whether it went.

### What was verified (static code read, 2026-09-04)

- **`appointment.changed` has exactly one producer** — `routes/jobs.ts:1033`. Calendar drag,
  the Move dialog, and the job screen all reach it through `PATCH /jobs/:id` (frontend uses
  the generated `useUpdateJob`). So fixing it everywhere is **one call site**; fixing it for
  the calendar alone would have meant *adding* a way to tell the routes apart — more work,
  not less.
- **Nothing depends on the automatic send.** `lib/automation-engine.ts` does not consume
  appointment events at all — its triggers are `days_after_last_service` and
  `inactive_customer`. The recurring-plan engine only fires on job *creation*, never on a move.
- **An event only sends if a matching active automation rule exists** in the DB
  (`lib/communication-dispatcher.ts:462-506`). With no rule it resolves to
  `no_active_automation` and nothing happens. **Whether such a rule exists on production is DB
  config and is not visible from the repo — confirm before shipping.**
- **The dispatcher runs in-process**, `setInterval` every 30s from `lib/scheduler.ts:36-53`,
  gated by `shouldStartMutationWorkers()`. Disabled on Sandbox 2 unless
  `BACKGROUND_PROCESSING_ENABLED=true`.
- **⚠️ There is no SMS provider anywhere in the repo.** No Twilio, no `sendSms`. SMS automation
  rules only write a `message_logs` row with `body: "[redacted]"` and `status:
  "not_dispatched"` (`communication-dispatcher.ts:296-344`). The client asked for text
  notifications; **the platform cannot currently deliver them.**
- **Time-only changes send nothing today.** The trigger is `dateChanged` only. But
  `scheduleChanges` / `touchesSchedule` at `jobs.ts:883-889` already computes date + start +
  end time for the schedule-lock check — reuse that.

### Scope agreed

**In scope — five interactive sites, all with a real user present:**

| Site | Trigger |
|---|---|
| `routes/jobs.ts:1033` | `PATCH /jobs/:id` — the reschedule, primary case |
| `routes/jobs.ts:770` | `POST /jobs` |
| `lib/customer-initial-job-db-adapter.ts:163` | `POST /customers/with-initial-job` |
| `routes/estimates.ts:534` | `POST /quotes/:id/convert-and-schedule` — **N per request** |
| `routes/recurring_plans.ts:313` | `POST /recurring-plans/:id/generate-job` |

`routes/jobs.ts:643` and `:674` also call the helper but are **unreachable** — `jobs.ts:548-554`
returns 409 `estimate_conversion_deferred` whenever `quoteId !== null`.

**Out of scope:** `routes/estimates.ts:232` and `routes/quotes.ts:590` use
`aggregateType: "quote"` — these are appointments to go *give* an estimate, not job
scheduling. Awaiting client confirmation that excluding them is right.

**Parked within the parked item:** `lib/recurring-plan-engine.ts:95` runs from
`cron.schedule("15 6 * * *")` with `actorId: "scheduler"`. No user exists to prompt. Awaiting
the client's answer.

### Agreed approach

**Do not enqueue until confirmed.** `communication_events.status` is capped by a DB CHECK
constraint to `pending|processing|succeeded|retrying|dead_letter`
(`lib/db/src/schema/communication_events.ts:69-72`), and that list is duplicated in three TS
files. Adding an `awaiting_confirmation` status means constraint replacement, which
`drizzle-kit push` handles unreliably and would need a full versioned application migration.

So instead: the five sites stop calling `enqueueCommunicationEvent` for appointment events and
write a **draft row**. On confirm, the existing send path runs. No CHECK constraint surgery, no
application migration — two plain new tables.

This also fixes undo for free: a new draft supersedes any open draft for the same job, so
move-then-undo leaves nothing to send.

### Plan (5 phases)

1. **Settings foundation** — new `communication_notification_settings` table modelled directly
   on `communication_quiet_hours` (`lib/db/src/schema/communication_safety.ts:36-57`): a
   singleton keyed by `organizationKey`, per-channel booleans. `GET`/`PUT` endpoints copying
   the shape of `routes/communication-safety.ts:554-681`, guarded by the **existing**
   `requireFinancialCapability("communication.settings")` — no new capability string needed.
   OpenAPI template at `openapi.yaml:3838-3873`. UI beside `CommunicationSafetySettings` in
   `pages/Settings.tsx:435`.
2. **Stop the automatic send** — new `appointment_notification_drafts` table; new pure module
   `lib/appointment-notification-core.ts` in the style of `lib/schedule-change-lock.ts`; wire
   the five sites; switch `dateChanged` → `touchesSchedule(scheduleChanges)`; return draft ids
   in the mutation response so the UI knows to prompt.
3. **Render, review, confirm** — **the largest piece.** The body is currently only built at
   send time inside `executeRule` (`communication-dispatcher.ts:247-345`), so there is nothing
   to show anyone beforehand. Extract `interpolate` (`:60-66`) and `getContext` (`:153-245`)
   into a shared module, render at draft time, then `GET` / `send` / `dismiss` endpoints.
4. **Prompt UI** — one shared component. Copy the shape of the crew double-booking dialog at
   `MonthCalendar.tsx:505-557`.
5. **Tests** — pure logic tests plus route capability/validation tests using the express +
   fake `req.user` pattern from `routes/communication-safety.test.ts:7-64`.

**Suggested split:** phases 1–2 fix the actual bug and are shippable alone. Phases 3–4 deliver
the review experience and are the bulk of the effort.

### Two traps in the existing code

1. **Undo is a forward PATCH**, not a rollback — `MonthCalendar.tsx:348` simply moves the job
   back. A prompt hung off `useUpdateJob.onSuccess` would fire again on undo. Fire from the
   decision layer (`commitMove` / `saveEdit` / modal submit).
2. **`TOAST_LIMIT = 1`** (`hooks/use-toast.ts:7`) — the undo toast and any notify toast cannot
   coexist; the second replaces the first. Keep the prompt in a dialog.

Also: the three reschedule sites disagree on blank values. `Schedule.tsx:182` sends
`|| undefined` (omit); `JobDetail.tsx:326` sends `|| null` (clear).
`lib/job-date-commit.ts:14-22` already encodes that convention — reuse it.

---

## Decision log

### User decisions

| Date | Decision |
|---|---|
| 2026-09-04 | **Option B** — fix the notification behaviour everywhere, not calendar-only. (Client's own words: consistent no matter where the schedule change is made.) |
| 2026-09-04 | Both notification settings ship **defaulting to OFF**, so nothing can leave the system until an admin deliberately enables it |
| 2026-09-04 | The overnight-cron question is **to be asked of the client**, not decided internally |
| 2026-09-04 | **Park the notification implementation.** Do not build it yet |
| 2026-09-04 | Maintain this file as the persistent handoff record |

### Client decisions (Lute / Kyle)

| Date | Decision |
|---|---|
| 2026-09-04 | Approved **Option B** |
| 2026-09-04 | Added: a business-level admin setting for whether schedule-change notifications are used at all — **email on/off and SMS on/off, independently** |
| 2026-09-04 | Added: **never send automatically**, even when channels are enabled. Prompt the user, let them review/edit, then confirm the channels |
| 2026-09-04 | Prompt applies on **initial scheduling as well as date/time changes** — this widened the scope from 1 call site to 5 |
| 2026-09-05 | **Multi-day value allocation: Option A** — full job value on the first scheduled day, later days zero (Kyle Stafford). Settles §7.18, §7.19, §9.3 |
| 2026-09-05 | **Monthly reporting uses the same anchor** — a job starting in August and running into September reports entirely in August (Kyle Stafford) |
| 2026-09-06 | **Republished Sandbox 2**, and offered Publisher access so deployments no longer need to go through him (Lute) |
| 2026-09-06 | **Move the database now**, before live scheduling data accumulates. Application, hosting, development and publishing all stay in Replit — only the database moves (Lute) |
| 2026-09-06 | Requirements attached to that: separate dev and production databases; schema stays owned by our migration system; automatic backups with a confirmed retention window; Lute owns the database account with our access separate; a **full restore** proven before the migration is called finished; connection/migration/backup/restore documented; and a guaranteed independent export path for changing provider later (Lute) |
| 2026-09-06 | **Gate:** provider, monthly cost, backup schedule and migration plan must be sent and approved **before** any production change (Lute) |
| 2026-09-06 | Feature work must continue in parallel so Kyle can keep testing (Lute) |
| 2026-09-07 | **Neon chosen** as the provider (user, agreeing with Lute's lean) |
| 2026-09-11 | **Sandbox 2 holds test data only — deletable without issue** (Kyle Stafford) |
| 2026-09-11 | **Superior is not running any operations through the system.** Any Superior customer, job, quote or invoice already loaded does not need to be retained and may also be deleted (Kyle Stafford) |
| 2026-09-11 | **No planned production setup changes** — *"It's whatever will use to test with superior"* (Lute Atieh) |

### My recommendations

| Date | Recommendation | Outcome |
|---|---|---|
| 2026-09-04 | Settle the four missing tables **before** writing more calendar UI | Open |
| 2026-09-04 | Option B is not just safer, it is **smaller** — A would require adding a route-source distinction that does not exist | Accepted by client |
| 2026-09-04 | Hold notifications in a new draft table rather than adding a status to `communication_events` — avoids CHECK constraint surgery across three files | Accepted, then parked |
| 2026-09-04 | Deliver phases 1–2 first as a standalone safety fix | Open |
| 2026-09-04 | Exclude estimate-visit appointments (`aggregateType: "quote"`) from this change | Needs client confirmation |

---

## Waiting on the client

1. **The overnight recurring-plan cron** (`lib/recurring-plan-engine.ts:95`) creates jobs at
   06:15 with nobody at a screen. Send nothing, park a draft for morning review, or allow
   auto-send on that path alone?
2. **SMS has no provider.** The toggle and the choice can be built, but no text will reach a
   customer. Does the client want an SMS provider integrated as part of this work?
3. **Move Entire Day** (V1 #11, not built) will move 20–30 jobs at once. Spec §8.6 calls for a
   batch review screen before messages are released. Confirm that is the intent.
4. **Estimate visit appointments** are excluded from the notification change. Confirm.

All four relate to the parked notification work, so none of them blocks the calendar roadmap.

**Answered and closed:** multi-day value allocation (§7.18, §7.19, §9.3) — Kyle Stafford chose
Option A on 2026-09-05. See "Step 1 is unblocked" above. Step 1 can now start.

**Answered and closed 2026-09-11 — the production environment questions.** Asked before
committing to Neon, because a wrong answer would have meant migrating live operational data.

| Asked | Kyle Stafford / Lute Atieh |
|---|---|
| Is the data in Sandbox 2 real or test? | *"Test data. It can be deleted without any issue."* |
| Is there another live production system to preserve? | *"Superior is not currently running any part of its operations through this system."* Any Superior customer, job, quote or invoice already loaded *"does not need to be retained and can also be deleted."* |
| Any planned production setup changes in the next few months? | Lute: *"No plans. It's whatever will use to test with superior."* |

Kyle's summary: **"there is no current live operational data that needs to be preserved."**

**What this changes.** Every remaining database step got cheaper and safer:

- **No production data migration.** Migration-plan steps 5, 6 and 8 below existed to move and
  prove a live dataset. There is no live dataset. They collapse into "create the schema in the
  production branch and verify it".
- **The region mismatch is now free to fix.** Recreating the Neon project in `us-west-2` costs
  nothing, because nothing in it is precious. Do this before pointing Replit at it.
- **Cutover stops being an event.** No out-of-hours window, no two-week read-only period on the
  old database — there is nothing to fall back to.
- **The `pg_dump`-not-rebuild rule no longer applies.** It existed to carry across the GIN
  trigram indexes `replit.md` mentions. With no data to preserve, `drizzle-kit push` from our
  own schema is the correct source of truth, and anything the TypeScript does not describe was
  never wanted.
- **Sandbox 2 can be wiped whenever it is convenient**, which makes backfill migrations easy to
  test from a clean state repeatedly.

The one thing it does *not* change: **the migration gate still needs a production path** before
anything runs against a production branch. That fix is unchanged and still required.

---

## Sandbox 2 deployment

`https://sandbox-2-data-free-corsteadllc.replit.app` — logins are `team_admin` (super admin),
`team_office` (office admin), `team_tech` (field tech).

**Tested 2026-09-05, and the deployed build predates all five calendar commits.** The app is
healthy — login works, the week view renders, zero console errors — but none of the calendar
work is on it:

- The Week/Month toggle is absent. It is rendered unconditionally in
  `Schedule.tsx:557-570`, so its absence is conclusive; that toggle arrived in `24f8a66`
- `GET /api/calendar/totals` and `/api/calendar/occurrences` both return **404**, so even
  `a439f26`, the earliest calendar commit, is not deployed
- `GET /api/jobs/unscheduled` returns 200, confirming it is an older but working build

**"Rev 83" in the footer proves nothing.** `artifacts/crm/src/version.ts` has only ever been
touched by the initial import commit, so the number was never bumped and cannot identify a
build. Do not use it to decide whether a deploy landed — probe an endpoint instead.

The Replit *workspace* does have the new code — the Vite `@dnd-kit/core` resolution error the
user hit names `MonthCalendar.tsx` — but the workspace needs `pnpm install`, and the deployed
app needs a redeploy. They are two separate things.

**The migration has not run either.** `.replit` sets `APP_MIGRATIONS_ENABLED = "false"` under
`[userenv.development]`, which the gate reads as disabled, so startup skips it silently and no
table is created. `APP_MIGRATION_ENVIRONMENT` and `APP_MIGRATION_SANDBOX_REPL_ID` are already
correct; only that one value needs to become `"true"`.

## Browser test of the deployed month view — 2026-09-06

Republished at last, and tested on Sandbox 2 as `team_admin`. **The calendar work is live and
behaves.** Verified: calendar endpoints return 200; the Week/Month toggle is present; the month
grid renders with adjacent-month spill days; weekly totals and the summary block appear; zero
console errors, so `@dnd-kit` resolves correctly in the built bundle; month paging works and
prefetches the neighbouring months; completed jobs carry `aria-disabled="true"` on their drag
handles, so `schedule-change-lock` is doing its job; at 390px there is no horizontal scroll.
The summary is also correctly labelled **Scheduled Job Value**, not "Sales" (§9.1).

### ✅ Fixed 2026-09-07 — the monthly summary counted spill days, putting a job in two months

Measured directly against the API:

| Range | Jobs | Value |
|---|---|---|
| True August (`08-01`..`08-31`) | 2 | $525.00 |
| True September (`09-01`..`09-30`) | **0** | **$0** |
| September's grid (`08-31`..`10-04`) | 1 | $100.00 |

September has no scheduled work at all, yet its summary block reads "Scheduled jobs 1 ·
Scheduled Job Value $100.00". That is the 31 August job (Emberlynn Haskins, 10000 cents)
appearing as a spill day — and the same $100 is counted again in August's summary, because
August's grid runs `07-27`..`09-06` and also contains 31 August.

Drawing the spill day is correct (§3.1) and counting it in the *weekly* total is correct. What
is wrong is the **monthly** summary using the grid range. It breaks §9.2 ("one job counts
once"), it is the double-counting §17 warns about, and it contradicts the client's 2026-09-05
decision that a job's value belongs to the month of its first scheduled day.

**The fix, applied 2026-09-07.** No extra request was needed. The server's `period` is itself a
plain `days.reduce(...)` over the same per-day rows (`routes/calendar.ts:186`), and each job
sits on exactly one date, so summing the in-month subset of `days` is the identical arithmetic
over the right window.

- New `artifacts/crm/src/lib/calendar-totals.ts` holds the totals types plus `totalsByDate` and
  a new `sumDayTotals(totals, includes)`. It exists as a separate module because
  `calendar-api.ts` reads `import.meta.env` and fetches, which makes it unloadable under
  `node:test` — the same reasoning behind the server's `*-core.ts` split. `calendar-api.ts`
  re-exports it, so no caller changed.
- `MonthCalendar.tsx` now builds the set of `GridDay.inMonth` dates and sums those. Day cells
  and the weekly footers still use the full grid, which is correct — a spilled day is real
  work on that week.
- `sumDayTotals` returns `undefined` before the first response, so an unknown figure still
  renders as "—" rather than a confident `$0.00`.
- 8 tests in `calendar-totals.test.ts`, including the two-months-one-job case and the
  hidden-amounts case where a null must not sum to zero. CRM suite: 350/351, the single
  failure being the known Windows path bug.

**Still to watch:** summing per-day rows is only safe while one job occupies one date. Once
`schedule_entries` allows multi-day jobs, a job would appear on several day rows and this
would double-count it — §9.2 again. When Step 2 lands, the roll-up has to count distinct jobs,
not add day rows.

### Not yet testable

Every job in the sandbox is **completed**, so all drag handles are correctly disabled. A
successful drag, the undo toast, and the crew double-booking dialog could not be exercised.
They need at least one job in `scheduled` status, ideally two on one day sharing a crew.

## Neon — development branch is live in the right region, 2026-09-11

**The region problem is fixed.** Joel recreated the project in **AWS US West 2**, matching where
Replit runs. The old `us-east-2` project (`crimson-lab-48199662`) is retired — confirm it is
deleted if it still shows in the console.

| | |
|---|---|
| Region | AWS US West 2 — same as Replit |
| Postgres | 18.6 |
| Development endpoint | `ep-ancient-resonance-ar0ob1sr.c-4.us-west-2.aws.neon.tech` |
| Database | `neondb` |

**⚠️ The console hands out the `-pooler` host.** The string Joel sent was
`ep-ancient-resonance-ar0ob1sr-pooler...`. Strip `-pooler` before using it: the transaction-mode
pooler disables prepared statements, which `node-postgres` and Drizzle rely on. Everything below
was done against the direct endpoint.

**Schema applied 2026-09-11.** `drizzle-kit push` created **75 tables**, including all four
calendar tables, `queue_status`, `schedule_entries_queue_idx` as
`btree (status, created_at, id)`, `allocated_value_cents` as `numeric(18,0)`, and 12 check
constraints on `schedule_entries`. Nothing has been applied to `production` — it still holds
zero tables, and must stay that way until the migration gate grows a production path.

### Verified again on the new project, not assumed

Bad rows inserted inside a transaction, then rolled back. Every constraint fired:

| Attempt | Result |
|---|---|
| Queued entry with `needs_contact` | accepted |
| On hold with a reason | accepted |
| An invented waiting reason | rejected — `schedule_entries_queue_status_check` |
| A waiting reason on scheduled work | rejected — `schedule_entries_queue_status_scope_check` |
| `scheduled` with no date | rejected — `schedule_entries_scheduled_needs_date_check` |
| `on_hold` with no reason | rejected — `schedule_entries_hold_needs_reason_check` |
| Money on a non-primary day | rejected — `schedule_entries_value_on_primary_check` |

### Data: seeded, not migrated — decided 2026-09-12

Replit's own database held 3 customers, 2 jobs, 5 quotes, 3 invoices and 4 users. A full
`pg_dump` was taken and is reproducible at any time, but **it was not restored**. The user chose
to start clean instead, and that was the right call: Kyle had already confirmed the data is
disposable, and two jobs would not have exercised the queue anyway.

**The one thing that actually mattered was the logins.** An empty `users` table means nobody can
sign in — not even to create the first account. So the three sandbox accounts were seeded
directly, keeping the exact credentials Kyle and Lute already have:

| Username | Role |
|---|---|
| `team_admin` | `super_admin` |
| `team_office` | `office_admin` |
| `team_tech` | `field_tech` |

`artifacts/api-server/src/lib/seed-team-users.ts` hashes with the same `hashPassword` the login
path verifies against, refuses a role `authorization.ts` does not know, and refuses usernames
that differ only in case (`users_username_lower_unique` is case-insensitive). 8 tests. Verified
against the live database: each password is accepted and each near-miss rejected.

**Two things that could not be done from this machine**, both blocked by the permission
classifier, both needing the user to act in their own terminal or the Neon console:

- `DROP SCHEMA public CASCADE` — use Neon's **Reset from parent** on the development branch
  instead. That is how the branch was emptied.
- Bulk SQL restore (`psql -f`, and running a dump through `node-postgres`). If a real restore is
  ever needed, hand the user the `psql` command rather than attempting it here.

**Also learned:** Neon does not grant `neondb_owner` either `--disable-triggers` (needs
superuser) or `SET session_replication_role = replica`. So a **data-only** restore into an
existing schema is not possible on Neon — the only route is a full dump into an empty schema,
where foreign keys are added after the data.

### From the first project, still true

### The constraints were proven, not assumed

Inserted deliberately bad rows inside a transaction and rolled back. The database refused
every one it should:

| Attempt | Result |
|---|---|
| Primary entry carrying the job's value | accepted |
| Second segment with zero value | accepted |
| **Money on a non-primary day** | **rejected** — `schedule_entries_value_on_primary_check` |
| A second primary for the same job | rejected — `schedule_entries_one_primary_unique` |
| `on_hold` with no reason | rejected — spec §4.6 holds |
| `scheduled` with no date | rejected |
| Time carrying seconds (`09:30:00`) | accepted — the Replit-compatibility fix works |
| An invented status | rejected |

So Kyle's Option A rule — a job's whole value on the day it starts, nothing on later days — is
enforced by the database itself, not merely by application code.

### Facts learned in the process

- **Neon runs PostgreSQL 18.6; Replit runs 16.** A dump from 16 restores into 18 fine. The
  reverse does not, so moving *back* to Replit later would not be a simple restore.
- **`sslmode=require` should be `sslmode=verify-full`.** `pg` warns that `require`'s meaning is
  changing; today it behaves like `verify-full`, but a library update would silently weaken it.
  Use `verify-full` in the strings we store.
- **Use the direct endpoint, never the `-pooler` host.** The console defaults to pooling on.
- **⚠️ `pnpm --filter @workspace/db run push` fails on Windows.** `drizzle.config.ts` builds the
  schema path with `path.join`, which yields backslashes, and drizzle-kit's internal glob reads
  a backslash as an escape — "No schema files found". Not a code defect; it works on Linux.
  Workaround, without touching the committed config:
  ```
  cd lib/db
  npx drizzle-kit push --dialect=postgresql --schema=./src/schema/index.ts --url="$DATABASE_URL"
  ```

### ⚠️ Wrong region — fix before anyone tests against it

The project is in **AWS US East 2 (Ohio)**. Replit's own Postgres — which is itself Neon — is in
**us-west-2**, so the application servers are there too. Every query would cross the country,
roughly 60 ms each way, and a page that issues a handful of queries feels it.

Neon cannot move a project between regions. The fix is to create a new project in `us-west-2`
and push the schema again. **Kyle confirmed on 2026-09-11 that nothing in any of these databases
needs preserving**, so today this costs ten minutes. After Kyle starts testing against it, it
becomes a data migration.

### Still to do

- Recreate the project in `us-west-2` (above), then re-push the schema
- Point the Replit development environment at this branch by setting `DATABASE_URL`
- Run the `calendar_schedule_entries_v1` and `calendar_queue_entries_v1` backfills there — they
  need the app's migration gate, so they run on Replit rather than from a laptop
- Everything in the revised migration plan below from step 5 onward

## Database move to Neon — the agreed plan

Agreed with Lute on 2026-09-06, provider settled 2026-09-07. **Nothing has been done yet.**

**Scope: only the database moves.** Application, hosting, development and publishing all stay
on Replit. This is not a plan to leave Replit.

**Why now:** the four Step 1 tables do not exist in any database yet. Moving first means they
are created once, in the right place. Moving in six weeks would mean migrating live scheduling
data instead.

### Why Neon rather than Supabase

Supabase's value is what surrounds the database — auth, file storage, realtime, an
auto-generated REST layer. **We use none of it**: there is a local username/password login
(verified by logging into Sandbox 2 with it), and files go to Google Cloud Storage. Adopting
Supabase would mean taking a platform to use one part of it.

There is also a concrete problem: Supabase's transaction-mode pooler disables prepared
statements, which `node-postgres` and Drizzle rely on. Workable, but a permanent trap.

Neon does one thing — Postgres — and its branching maps onto Lute's dev/production requirement:
development can be a branch of production, so it holds realistic data and resets in seconds.

### Nothing about the schema changes

Worth being explicit, because it is the obvious worry. Both are PostgreSQL. Same 59 tables,
same columns, same constraints, same indexes. The schema is defined in TypeScript under
`lib/db/src/schema/` and our own migration system owns it — which is exactly what Lute asked
for. On our side the move is one connection string.

`lib/db/src/index.ts` is a plain `new Pool({ connectionString: process.env.DATABASE_URL })`
with no Replit-specific driver, so there is nothing else to unpick.

Verified: the only Postgres function used beyond the standard set is `gen_random_uuid()`,
built in since PG 13. No extensions to port.

~~**But copy production with `pg_dump`, do not rebuild it from the schema.**~~ `replit.md:69`
mentions GIN trigram indexes that do not appear anywhere in the Drizzle schema, so the live
database may hold objects the TypeScript does not describe. A dump would carry those across; a
rebuild loses them.

**Superseded 2026-09-11.** Kyle confirmed there is no operational data to preserve, so there is
nothing to dump. Build the schema from `lib/db/src/schema/` instead — it is the source of truth,
and an object the TypeScript does not describe is an object nobody asked for. If a trigram index
turns out to be needed for search performance, add it to the schema deliberately.

### Cost — estimates from published pricing, to be confirmed after a month

| Plan | Restore history | Rough monthly, both databases |
|---|---|---|
| Launch | 7 days | $25–40 |
| Scale | 30 days | $50–80 |

Compute is $0.106/CU-hour on Launch, storage $0.35/GB-month, history $0.20/GB-month. Storage
for a database this size is a rounding error; almost all of it is compute. Recommendation:
Launch plus our own nightly export, which buys longer retention for far less than Scale.

### Backups are two separate things

1. **Instant restore**, built in. Neon keeps a continuous change history, so we can rewind to
   any moment inside the window. This covers accidental deletes.
2. **Scheduled export**, which we build. Instant restore is *not a file*. Leaving Neon, or
   needing something older than the window, needs real `pg_dump` output — nightly to object
   storage, 30 days daily and 12 months monthly.

Only point 2 answers Lute's "export independently" requirement. The two are easy to conflate
and he asked for both.

### ⚠️ One code fix is required before any production cutover

`evaluateMigrationGate` refuses anything whose `APP_MIGRATION_ENVIRONMENT` is not `"sandbox"`,
and `runRequiredMigrationsAtStartup` **throws** when migrations are enabled but not eligible.
Against a production database the server would refuse to boot. The gate needs a production
path, with stricter confirmation than sandbox. This has to land before step 7 below.

### Migration plan — revised 2026-09-11

Rewritten after Kyle confirmed there is no operational data to preserve. The original plan was
shaped around moving a live dataset safely; that risk is gone.

| # | Step | State |
|---|---|---|
| 1 | Neon account with Lute as owner, us added — access separate from the start | Done; ownership to move to Lute |
| 2 | Two branches: `production` (default) and `development` | Done |
| 3 | **Recreate the project in `us-west-2`** to match where Replit runs | **Done 2026-09-11** |
| 4 | `drizzle-kit push` the schema into `development` | **Done 2026-09-11** — 75 tables, constraints proven |
| 5 | Point Replit development at Neon (`DATABASE_URL`) and set `APP_MIGRATIONS_ENABLED = "true"` | **Next — this is the blocking step** |
| 6 | Run the calendar backfill migrations there, from a clean database | Next |
| 7 | Fix the migration gate to allow a production environment | Before step 8 only |
| 8 | Create the schema in `production` and verify it matches `development` | Not started |
| 9 | Nightly `pg_dump` export to object storage — Lute's "export independently" requirement | Not started |
| 10 | Prove a restore into a scratch database before calling this finished | Not started |
| 11 | Document connection, migration, backup and restore | Not started |

**Dropped from the original plan:** copying production data across and verifying row counts;
the out-of-hours cutover window; leaving the Replit database read-only for two weeks. All three
existed to protect data that does not exist.

**Step 3 is the one with a deadline.** The Neon project sits in `us-east-2` while Replit runs in
`us-west-2` — roughly 60 ms per round trip between them, on every query. While both branches are
empty this is a delete-and-recreate. Once Kyle is testing against it, it is a data migration.

**Settled:** Lute asked for separate dev and production; the user at one point said a single
database. Neon branches give both readings what they want — one project, one bill, two isolated
databases — so this is no longer open.

---

## Architecture — asked and answered 2026-09-07

The user asked whether to restructure the codebase into MVC, with models and controllers in
separate folders, for future scalability.

**Measured first:**

| Layer | State |
|---|---|
| Models | Already separate — 59 schema files in their own package, `lib/db` |
| Controllers | Present but fat — **18,324 lines** across `routes/`, `jobs.ts` alone 1,371 |
| Domain logic | 12 `*-core.ts` pure modules — a good pattern, applied inconsistently |

**Decision: no big-bang restructure. Adopt the layering on new code, and migrate old code as we
touch it.**

Reasoning:

- **"MVC" is the wrong label here — there is no View.** This is a headless API with a separate
  React SPA. What is actually wanted is layering: routes → services → repositories → models.
  Calling it MVC invites confusion about where the V went.
- **The `*-core.ts` pattern is the codebase's best asset and a classic MVC refactor would
  destroy it.** Those modules are dependency-free, which is precisely why ~400 server tests run
  with no database. Fat models would take that away.
- **Timing.** Lute asked explicitly that feature work not stall, and the database move is
  already in flight. Two structural changes at once means debugging both together.
- **`estimate-appointment-contract.test.ts:227-308` regex-matches the source text of
  `quotes.ts`** and asserts an exact stage list. A restructure breaks it, and it guards a real
  invariant.

Target shape, to be used for Step 2 since it is entirely new code:

```
routes/schedule-queue.ts         HTTP only — parse, authorize, respond
services/schedule-queue.ts       business rules, transactions
repositories/schedule-entry.ts   Drizzle queries, no rules
lib/schedule-queue-core.ts       pure decisions, no I/O
lib/db/src/schema/*.ts           models (already there)
```

This sets the pattern at zero risk, then `jobs.ts` gets extracted when Step 4 touches it.

---

## Environment gotchas

- **`node_modules` was found broken on 2026-09-05 and has been repaired.** Every top-level
  package directory was empty (`typescript`, `drizzle-orm`, `zod`, `date-fns`) while
  `node_modules/.pnpm` still held the content — the symlinks pnpm puts at the top level were
  gone. A reinstall fixed it. If it happens again, suspect anything that copies the tree
  without preserving symlinks.

- **`pnpm` is not on PATH and cannot be put there.** `corepack enable pnpm` fails with EPERM
  because it writes to `C:\Program Files\nodejs`. Run it through corepack instead:
  `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true corepack pnpm@10 <command>`. Two gotchas: the root
  `preinstall` script needs `sh`, so **run installs from Git Bash, not PowerShell**; and any
  script that calls `pnpm` recursively (the root `typecheck` does) needs a `pnpm.cmd` shim on
  PATH forwarding to `corepack pnpm@10`.

- **There is no local database.** No `.env` anywhere and `DATABASE_URL` is unset; `.replit`
  provisions `postgresql-16`, so the database lives in the Replit environment. Consequently
  `drizzle-kit push` and the migration CLI **cannot be run from this machine** — they have to
  run where `DATABASE_URL` exists.

- **Known pre-existing test failures** (verified 2026-09-05, unrelated to any current work):
  api-server 392/407 pass, the 15 failures all being `DATABASE_URL must be set`; crm 342/343
  pass, the one failure being a Windows path bug inside `src/lib/auth-scope.test.ts` that
  builds `E:\E:\Projects\...`. Treat both as the baseline.
- **Playwright MCP is configured** in `.mcp.json` at the repo root (`npx -y @playwright/mcp`),
  with Chromium installed. Browser tools require a session restart to load, and the server has
  timed out on connect at least once (30s) — retry rather than assuming it is missing. It was
  used to test the deployed calendar on 2026-09-06 and is the fastest way to check a deploy
  actually landed.
- **Probe an endpoint to tell whether a deploy landed.** The footer's "Rev" number comes from
  `artifacts/crm/src/version.ts`, which has not changed since the initial import, so it is
  useless for identifying a build. `GET /api/calendar/totals` returning 404 versus 200 was what
  actually settled it.
- **Replit's workspace and its published app are two different things.** Pulling code into the
  workspace does not change `sandbox-2-data-free-corsteadllc.replit.app`; that needs a
  Republish. The user could not republish until Lute granted Publisher access.
- **Never run `git commit` or `git push`.** Give the user the commit message to paste.
- `lib/db/src/schema/communication-safety-immutability.sql` is **not referenced by any code**
  — a manual DBA artifact. Its append-only triggers cover only
  `communication_preference_history` and `communication_eligibility_decisions`.
- Schema changes go through `drizzle-kit push`, **not** migration files — there are no
  checked-in Drizzle SQL migrations. A new table needs its schema file **plus** an
  `export * from "./name.ts";` line in `lib/db/src/schema/index.ts`, or push ignores it. The
  separate `artifacts/api-server/src/migrations/` framework is reserved for data-bearing or
  destructive changes.
- `routes/estimate-appointment-contract.test.ts:227-308` **regex-matches the source text** of
  `routes/quotes.ts` and asserts an exact stage-name list. Reordering or renaming stages there
  breaks it.
