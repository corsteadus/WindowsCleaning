# Sync Prompts — Window Cleaning CRM Stabilization Work

**Purpose:** Bring a duplicate copy of this app up to date with the stabilization work
completed in the source Sandbox (commits `4485b61` → `4aea8d8`, Aug 2026), without
re-discovering anything.

**How to use:**
1. Paste **Prompt 0** into the duplicate app's agent first. It changes nothing — it reports
   which of Prompts 1–6 are actually needed (the duplicate may already contain older fixes,
   depending on when it was copied).
2. Paste the needed prompts **one at a time, in order**. Each ends with verification —
   do not continue to the next prompt until the current one reports green.
3. Prompt 7 is the final full check.

**What does NOT sync via these prompts:** each app's own database records (customers,
leads, jobs) and secrets. No schema changes are involved anywhere below.

---

## Prompt 0 — Orient and report (NO changes)

```
Do not change any code in this step. This app is a duplicate of a source app whose
stabilization state I want to replicate. Investigate and report ONLY:

1. Run these and report pass/fail with error counts:
   - pnpm --filter @workspace/api-server run typecheck
   - pnpm --filter @workspace/crm run typecheck
   - pnpm run typecheck:libs
   - pnpm --filter @workspace/api-server run test (if a test script exists)
   - pnpm --filter @workspace/crm run test (if a test script exists)
2. Report whether each of these files exists:
   - artifacts/api-server/src/lib/date.ts, quote-convert.ts, job-create-quoted.test.ts, lead-convert.ts
   - artifacts/crm/src/lib/recurring-plan-form.ts, job-date.ts, customer-list.ts, property.ts
3. Report whether the API and CRM use "propertyName" or "propertyNickname" in
   lib/api-spec/openapi.yaml.
4. Report whether POST /leads/:id/convert in artifacts/api-server/src/routes/leads.ts
   uses a db.transaction with pg_advisory_xact_lock, or does a bare insert.

Based on results, tell me which of these work items are MISSING here:
(1) Radix sentinel fix, (2) future-dated job guard, (3) zero typecheck errors,
(4) propertyName rename, (5) idempotent quote→job conversion + POST /jobs guard,
(6) idempotent lead→customer conversion + CRM quote-flow links.
```

---

## Prompt 1 — Radix `<Select>` sentinel fix (Create Recurring Plan crash)

```
Constraints: no schema changes, no secrets, no publishing, no mutating live tests
(validation/404 checks only). Typechecks must end at 0 errors. No `any`, no ts-ignore,
no unsafe casts. Test imports use the `.ts` extension. Skip anything already present.

Fix the Create Recurring Plan page crash caused by Radix <Select> receiving an empty
string value.

1. Create artifacts/crm/src/lib/recurring-plan-form.ts exporting sentinel constants:
   CUSTOMER_NONE = "none", PROPERTY_NONE = "none", SERVICE_NONE = "none"
   plus pure helpers that convert between sentinel values and the real
   `number | undefined` ids used in the create-plan API payload (fromSelectValue /
   toSelectValue style). Never pass "" as a Radix <Select> item value or selected value.
2. Refactor artifacts/crm/src/pages/RecurringPlanNew.tsx to use these helpers for the
   customer, property, and service selects: placeholder state uses the sentinel, and the
   submit payload sends undefined (not 0, not "") when the sentinel is selected.
3. Add executable tests in artifacts/crm/src/lib/recurring-plan-form.test.ts using
   node:test + node:assert/strict covering: sentinel round-trips, real id round-trips,
   payload conversion for unset values.
4. Ensure artifacts/crm/package.json has a test script using
   `node --test --experimental-strip-types` and include this test file in it.

Verify: pnpm --filter @workspace/crm run test, pnpm --filter @workspace/crm run
typecheck (0 errors), then confirm the Recurring Plan New page renders without console
errors. Commit with a clear message.
```

---

## Prompt 2 — Block completing future-dated jobs

```
Constraints: no schema changes, no secrets, no publishing, no mutating live tests
(validation/404 checks only). Typechecks must end at 0 errors. No `any`, no ts-ignore,
no unsafe casts. Test imports use the `.ts` extension. Skip anything already present.

Prevent jobs scheduled in the future from being marked completed.

1. API: create artifacts/api-server/src/lib/date.ts exporting:
   - businessDateStr(now: Date = new Date()): string — returns the current business
     date as YYYY-MM-DD using toLocaleDateString("en-CA")
   - isScheduledInFuture(scheduledDate, today = businessDateStr()): boolean — string
     compare of YYYY-MM-DD values; tolerant of null/undefined (returns false)
2. API guard: in the job status-update path of artifacts/api-server/src/routes/jobs.ts,
   reject transitioning a job to "completed" when isScheduledInFuture(job.scheduledDate)
   is true — respond 400 with a clear error message. No other transitions change.
3. CRM: create artifacts/crm/src/lib/job-date.ts exporting todayDateStr() and
   isJobScheduledInFuture(...) with the same YYYY-MM-DD comparison semantics.
4. CRM UI: in artifacts/crm/src/pages/JobDetail.tsx disable the "Mark Completed"
   action when the job is scheduled in the future, with a tooltip/hint explaining why.
5. Tests: artifacts/api-server/src/lib/date.test.ts and
   artifacts/crm/src/lib/job-date.test.ts (node:test), covering: today, past,
   future, null/undefined, month/year boundaries, and timezone-stable comparison
   (string compare, never Date subtraction). Add both files to their package test scripts.

Verify: both package test suites pass; both typechecks 0 errors. Live check must be
non-mutating only (e.g. GET a job). Commit.
```

---

## Prompt 3 — Zero TypeScript errors, safely

```
Constraints: no schema changes, no secrets, no publishing, no mutating live tests.
No `any`, no ts-ignore, no `as unknown as` double-casts, no unsafe assertions —
fix types properly or narrow with real runtime guards. Skip if typechecks already pass.

Bring the whole workspace to 0 TypeScript errors:
- pnpm --filter @workspace/api-server run typecheck
- pnpm --filter @workspace/crm run typecheck
- pnpm run typecheck:libs

While doing the CRM cleanup, if list endpoints return `unknown`-shaped data, create
artifacts/crm/src/lib/customer-list.ts exporting
`extractCustomerArray<T extends object>(raw: unknown): T[]` — a runtime-guarded
extractor that accepts either a bare array or a paginated { data: [...] } envelope and
returns [] for anything else. Use it in pages that consume customer lists (e.g.
AdminImport, JobNew, QuoteNew) instead of casting. Add
artifacts/crm/src/lib/customer-list.test.ts covering: bare array, envelope, empty,
null, garbage input, and non-object items filtered or preserved per implementation.

For Drizzle transaction typing use:
type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

Verify: all three typechecks 0 errors, all tests pass. Commit.
```

---

## Prompt 4 — Rename propertyNickname → propertyName end-to-end

```
Constraints: no schema changes (this is an API/UI field rename, not a DB column
change — verify the DB column name stays untouched), no secrets, no publishing,
no mutating live tests. Typechecks 0 errors. Skip if openapi.yaml already says
propertyName.

Rename the API/UI field propertyNickname to propertyName everywhere:

1. lib/api-spec/openapi.yaml — rename the field on job, quote, and recurringPlan
   schemas; regenerate lib/api-zod and lib/api-client-react generated code with the
   repo's codegen workflow.
2. API: update the property-enrichment mapping used by routes/jobs.ts,
   routes/quotes.ts, routes/recurring_plans.ts so responses emit propertyName.
3. CRM: create/extend artifacts/crm/src/lib/property.ts with
   `propertyLabel(p: PropertyLike): string` (nickname/name falling back to address)
   and a job-focused helper for lists (jobPropertyLabel style); update Dashboard,
   Jobs, Quotes, Schedule, RecurringPlans, RecurringPlanDetail to use them.
4. Tests: artifacts/crm/src/lib/property.test.ts and
   artifacts/api-server/src/lib/property-enrich.test.ts covering fallback order and
   null/missing fields.

Verify: full typechecks (api, crm, libs) 0 errors; both test suites pass; GET one
job/quote via curl (read-only) shows propertyName in the JSON. Commit.
```

---

## Prompt 5 — Idempotent quote→job conversion + POST /jobs quoteId guard

```
Constraints: no schema changes, no secrets, no publishing, no mutating live tests
(validation/404 only — successful-conversion behavior is proven by executable tests).
Typechecks 0 errors. No `any`/ts-ignore/unsafe casts. Test imports use `.ts` extension.
Skip parts already present.

Make quote→job conversion idempotent and race-safe, and close the POST /jobs bypass.

1. Create artifacts/api-server/src/lib/quote-convert.ts (pure, NO drizzle/pg imports):
   - quoteAdvisoryLockKey(quoteId: number): number — returns the raw quoteId; BOTH
     endpoints below must use it so they share one lock namespace.
   - buildJobLineItemsJson(lineItems): string | null — maps quote line items to the
     JSON string stored in jobs.lineItems ({description, quantity, unitPrice,
     totalPrice} with numeric fields as numbers); null when empty.
   - interface ConvertAdapter { acquireAdvisoryLock(quoteId); findJobByQuoteId;
     findQuoteById; findLeadById; fetchLineItems; setQuoteApproved; insertJob } —
     acquireAdvisoryLock MUST be called first; a throw aborts with no mutation.
   - convertQuoteCore(quoteId, adapter) with fixed step order: lock → idempotency
     check (existing job → kind "existing") → load quote (null → "notFound") →
     resolve customerId (customer-owned directly; lead-owned via
     lead.convertedCustomerId, unconverted lead → kind "error" with message telling
     the user to convert the lead first) → fetch line items → setQuoteApproved →
     insertJob (status "scheduled", jobNumber `J-${Date.now()}`). Returns a
     discriminated union: existing | created (with forLog data) | notFound | error.
   - interface CreateQuotedJobAdapter + createQuotedJobCore(quoteId, jobValues,
     adapter): lock → existing job → kind "conflict" (route returns 409 with the
     existing job id) → missing quote → "quoteNotFound" (404) → insertJob.
2. Route POST /quotes/:id/convert (routes/quotes.ts): run convertQuoteCore inside
   db.transaction with a DrizzleTxAdapter whose acquireAdvisoryLock executes
   `SELECT pg_advisory_xact_lock(${quoteAdvisoryLockKey(quoteId)})` on the
   transaction. "existing" → 200 with the job, NO new activity log. "created" →
   activity log written AFTER the transaction commits, then 200.
3. Route POST /jobs (routes/jobs.ts): when the payload includes quoteId, run
   createQuotedJobCore inside db.transaction with an adapter using the SAME
   quoteAdvisoryLockKey. Duplicate → 409; missing quote → 404. Jobs without quoteId
   are unchanged.
4. Tests: src/lib/quote-convert.test.ts and src/lib/job-create-quoted.test.ts
   (node:test, in-memory fake adapters; an AsyncMutex — a Promise-chain class whose
   withLock(fn) queues callers and always advances even when fn rejects — simulates
   pg_advisory_xact_lock serialisation). Cover: first conversion, repeat → existing
   without second insert/approve, simultaneous same-quote (exactly one job),
   different quotes in parallel, lock-first ordering, lock failure → no mutation,
   line-item preservation (numbers, empty → null), lead-owned quote resolution,
   unconverted/missing lead errors, POST /jobs conflict/notFound paths.
   Add both files to the api-server test script.

Verify: pnpm --filter @workspace/api-server run test all green; typecheck 0 errors;
non-mutating live check only (POST convert on a nonexistent quote id → 404). Commit.
```

---

## Prompt 6 — Idempotent lead→customer conversion + CRM quote-flow links

```
Constraints: no schema changes, no secrets, no publishing, no mutating live tests
(validation/404 only). Typechecks 0 errors. No `any`/ts-ignore/unsafe casts. Test
imports use `.ts` extension. Skip parts already present.

Backend — make POST /leads/:id/convert idempotent and race-safe:

1. Create artifacts/api-server/src/lib/lead-convert.ts (pure, NO drizzle/pg imports):
   - LEAD_LOCK_CLASSID = 2 and
     leadAdvisoryLockKey(leadId): readonly [number, number] returning
     [LEAD_LOCK_CLASSID, leadId]. Locks are taken with the TWO-argument form
     pg_advisory_xact_lock(classid, objid) — PostgreSQL keeps the (int4,int4)
     keyspace fully separate from the single-int keyspace used by quote locks, so
     collision is impossible by construction. Do NOT use an additive offset.
   - interface ConvertLeadAdapter<C> { acquireAdvisoryLock; findLeadById;
     findCustomerById; insertCustomer; markLeadConverted } — generic over the
     customer row type so the route needs no casts. markLeadConverted MUST throw
     when it updates zero rows (lead deleted concurrently) so the shared transaction
     rolls back the customer insert.
   - convertLeadCore(leadId, customerDate, adapter), step order: lock FIRST →
     findLeadById (null → "notFound") → if convertedCustomerId is set, load that
     customer and return kind "existing" (missing customer row → kind "staleLink"
     with the dangling id) → insertCustomer copying lead fields (firstName,
     lastName, email, phone, address→billingAddress, city→billingCity,
     state→billingState, zip→billingZip, source, notes, clientType ?? "residential",
     status "active", customerDate = the passed-in business date) →
     markLeadConverted(leadId, customer.id) setting status "won" +
     convertedCustomerId atomically. Returns existing | staleLink | notFound |
     created (with forLog {leadId, customerId}). The lead row is preserved; no
     properties/contacts are created.
2. Route (routes/leads.ts): validate the id (NaN → 400); run convertLeadCore inside
   db.transaction with a DrizzleTxLeadAdapter (markLeadConverted uses
   .returning({id}) and throws on empty). Map outcomes: notFound → 404;
   staleLink → 409 with a clear message; existing → 200 with the serialized
   customer and NO new activity log; created → write exactly ONE activity log
   (entityType "lead", action "converted", toValue = customer id) AFTER the
   transaction commits, then 200. customerDate comes from businessDateStr() in
   src/lib/date.ts.
3. Tests in src/lib/lead-convert.test.ts (node:test, fake adapter + AsyncMutex as in
   Prompt 5): lock-key shape (pair, classid constant, structurally distinct from the
   scalar quote key), first conversion copies fields + sets customerDate + marks lead
   won, repeat → existing with no second insert, staleLink, notFound, lock failure →
   only the lock call in the log, insert failure → markLeadConverted never called,
   lead deleted mid-conversion → markLeadConverted throws and nothing is marked,
   simultaneous same-lead → exactly one customer, different leads in parallel,
   queued caller proceeds after a failed predecessor. Add the file to the api-server
   test script.

CRM — connect the flow:

4. LeadDetail.tsx: the convert mutation's onSuccess must navigate to
   `/customers/${customer.id}` using the id from the conversion response. When
   lead.convertedCustomerId is set, render a visible "View Customer Account" link to
   `/customers/${lead.convertedCustomerId}` (decorative chevron icon gets
   aria-hidden="true"). Hide the Convert button when status is "won" or "lost".
5. CustomerDetail.tsx: next to the existing "Schedule Job" button (shown when
   !isEditing && customer.status === "active"), add a "New Quote" button that
   navigates to `/quotes/new?customerId=${customer.id}`.
6. QuoteNew.tsx: on mount, read `customerId` from window.location.search via
   new URLSearchParams (wouter has no search-params hook). Validate it as a positive
   integer, fetch that customer with the generated useGetCustomer hook (enabled only
   when valid), and initialize the CustomerCombobox selection once — a manual user
   selection afterwards must win. The submit payload derives customerId ONLY from the
   selected customer state, so the preselected id is exactly what is sent.

Verify: pnpm --filter @workspace/api-server run test all green; api-server + crm
typechecks 0 errors; restart the API workflow; non-mutating live checks only:
POST /api/leads/99999999/convert → 404 and POST /api/leads/abc/convert → 400. Do NOT
convert a real lead — successful-path behavior is proven by the executable tests.
Commit.
```

---

## Prompt 7 — Final full verification

```
Run and report, fixing nothing unless something fails:
1. pnpm --filter @workspace/api-server run test   (expect all tests green)
2. pnpm --filter @workspace/crm run test          (expect all tests green)
3. pnpm --filter @workspace/api-server run typecheck  (0 errors)
4. pnpm --filter @workspace/crm run typecheck         (0 errors)
5. pnpm run typecheck:libs                            (0 errors)
6. Restart the API and CRM workflows; confirm both come up clean.
7. Non-mutating spot checks: GET /api/leads?limit=1 → 200 JSON;
   POST /api/leads/99999999/convert → 404; POST /api/leads/abc/convert → 400.
If anything fails, fix it within the constraints used throughout (no schema changes,
no secrets, no publishing, no mutating live tests) and re-run the affected checks.
Report a table of results.
```

---

## Reference — source-of-truth state after all prompts

| Area | Expected end state |
|---|---|
| api-server tests | 112 passing (`date`, `property-enrich`, `quote-convert`, `job-create-quoted`, `lead-convert`) |
| crm tests | 4 suites passing (`property`, `recurring-plan-form`, `job-date`, `customer-list`) |
| Typechecks | api-server 0, crm 0, libs 0 |
| Lock namespaces | quotes/jobs: `pg_advisory_xact_lock(quoteId)`; leads: `pg_advisory_xact_lock(2, leadId)` |
| Conversion semantics | Both convert endpoints idempotent: repeat → 200 existing entity, exactly one activity log ever |
