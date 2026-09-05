# Project decisions and working context

**Last updated:** 2026-09-05

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
  with Chromium installed. Browser tools require a session restart to load. Useful for testing
  the calendar for real — drag-and-drop, overlap warnings, month paging.
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
