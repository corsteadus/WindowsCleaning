---
name: Project architecture and risk map
description: Durable whole-repository map of the WindowCleaning CRM, its workflows, boundaries, verification baseline, and known risks as of 2026-09-08.
---

# Project architecture and risk map

Use this as the starting context for future work. `PROJECT_DECISIONS.md` remains the chronological product/roadmap record; this file describes the implemented repository and its current technical boundaries.

## Repository shape

- This is a pnpm/TypeScript monorepo targeting Node 24.
- `artifacts/api-server` is an Express 5 ESM API using Drizzle/PostgreSQL, Zod, Pino, node-cron, Stripe, Nodemailer, Replit OIDC, and Google Cloud Storage.
- `artifacts/crm` is a React 19/Vite 7/Tailwind 4 SPA using TanStack Query, Wouter, React Hook Form, Radix/shadcn, Recharts, DnD Kit, Uppy, and PapaParse.
- `artifacts/mockup-sandbox` is a generic Vite preview harness. It currently has no tracked product mockup components.
- `lib/db` owns the Drizzle connection and schema modules.
- `lib/api-spec/openapi.yaml` is the handwritten contract. Orval generates `lib/api-client-react` and `lib/api-zod`; generated files must not be hand-edited.
- `lib/replit-auth-web` owns the browser auth store/hook.
- `lib/object-storage-web` is an Uppy abstraction, but the CRM currently uses its own `FilesTab` upload implementation instead.
- Approximate source scale at this snapshot: 848 TS/TSX files and 122,700 lines, including generated clients. API source is about 44,232 lines; CRM source about 38,359 lines.

## Runtime flow

```text
React SPA
  -> generated Orval hooks or protectedFetch
  -> Express middleware (logging, CORS, cookies, parsers, auth, cache, RBAC)
  -> route module
  -> mixed route logic or extracted pure *-core/service + adapter
  -> Drizzle transaction/query
  -> PostgreSQL

API side integrations
  -> Replit OIDC / local scrypt auth
  -> Stripe payment links + webhook
  -> SendGrid, Mailgun, SMTP, or mock email
  -> Google Cloud Storage signed uploads/downloads
  -> in-process cron/interval workers
```

- `api-server/src/index.ts` runs required application migrations before listening, then conditionally starts legacy maintenance and mutation workers.
- `api-server/src/app.ts` mounts the Stripe raw-body route before global 50 MB JSON/urlencoded parsers, then authentication, cache headers, authorization, the router, and a JSON error handler.
- Route modules are generally “fat”: input parsing, RBAC refinements, business rules, Drizzle SQL, transactions, activity logging, outbox writes, and serialization often live together.
- The preferred newer pattern is a pure `*-core.ts` function plus a narrow adapter/repository and one transaction boundary. Continue extracting toward routes -> services -> repositories/adapters -> pure core.
- The browser query cache is auth-scoped. User/role/capability/assignment changes purge queries and mutations; 401 invalidates the session and 403 revalidates authority.

## Data model

- `lib/db` declares roughly 75 PostgreSQL tables. Major groups are authentication; customers/leads/contacts/properties/profile metadata; quotes and immutable estimate lifecycle; jobs/crews/recurring work/scheduling; invoices/payments/credits/approvals/reconciliation; communication automation/safety/outbox; attachments/audit/idempotency/import/migration operations.
- The application is hard-coded to one tenant (`single-tenant`); business tables have no organization/tenant key.
- Legacy and normalized representations coexist: customer contact/address columns plus contact/property relationships, quote/invoice JSON line items plus normalized line tables, crew text fields plus crew members, and legacy job schedule fields plus new schedule tables.
- Most legacy logical relationships are enforced in TypeScript rather than PostgreSQL foreign keys. New schedule schemas have stronger constraints and foreign keys.
- Monetary storage is mixed (decimal-dollar strings/numerics and integer cents). New finance cores convert to exact `BigInt` cents and round half up.
- Business dates are mostly `YYYY-MM-DD` strings; instants use timestamptz or legacy ISO text. America/Chicago is the principal business timezone.

## Implemented workflows

- Leads/prospects: a legacy `leads` entity and customer accounts with `lifecycleStatus=prospect` coexist. The `/leads` list UI is the prospects customer list, while lead detail still uses the legacy lead table. Lead conversion is advisory-lock serialized and idempotent.
- Customers: paginated search/filter, strong email/phone duplicate candidates, explicit duplicate override, profile metadata, canonical contacts/properties, shared account-property relationships, default-property derivation, archive/deactivate behavior, and atomic customer + accepted initial job creation.
- Quotes/estimates: quote lines, appointments, locations, immutable finalized revisions, hashed public decision links, delivery/activity records, acceptance, follow-up, conversion preview, legacy quote-to-job conversion, and atomic accepted revision-bound multi-location job conversion.
- Jobs/crews/calendar: scheduling, status, recurring metadata, direct technician and normalized crew assignments, role-aware redaction, append-only field-tech notes, forward-only technician status changes, month/week calendar, drag rescheduling, undo, overlap warnings, and completion/invoice locks.
- Recurring plans: CRUD plus a daily generator that creates jobs and advances the next date.
- Finance: multi-job invoices, normalized lines, exact payment allocations, customer credits/refunds, append-only invoice void/credit/reissue corrections, approval workflows, and reconciliation/export.
- Communications: one-off and bulk email, templates, campaigns, automation rules, consent/suppression/quiet-hours eligibility, append-only safety decisions, outbox deliveries/attempts/audits, leasing, retries, and dead-letter behavior. SMS eligibility is modeled but no SMS provider dispatch exists.
- Imports: Customer Factor upload/normalize/stage/review/apply/rollback with provenance, advisory locks, resumable staging, change logs, and conservative exact-signal matching. Legacy one-off import scripts still exist separately.
- Dashboard/tasks/services/admin: period-aware operational/financial metrics, related-entity tasks, service catalog management, team users, repair/dedup/export/purge administration, and profile/settings screens.

## Important invariants

- Client-side RBAC is presentation only; enforce capabilities and row scope in the API.
- Field technicians see assigned-work-scoped and redacted customer/property/job data.
- Accepted estimate conversion must remain bound to the immutable accepted revision and revalidate active account locations/assignees inside one transaction.
- Financial corrections are append-only; payments/credits use exact allocations, locks, idempotency keys, and transactions.
- Data Free Sandbox startup must remain non-mutating unless explicit environment flags and the current Sandbox identity attest the operation.
- Live smoke tests must be non-mutating. Successful mutation behavior belongs in executable tests unless the owner explicitly authorizes live mutation.
- Never commit or push unless the owner explicitly requests it.

## Implemented versus scaffolded

- Runtime calendar reads and writes still use legacy `jobs.scheduled_*` fields.
- `schedule_entries`, `schedule_assignments`, `calendar_events`, and `calendar_preferences` exist in schema/migration code but have no production route/UI usage. Their migration is disabled by `.replit` (`APP_MIGRATIONS_ENABLED=false`). Queue/on-hold, split work, richer views/preferences, and bulk calendar workflows remain incomplete.
- The planned Neon database move is approved but not implemented. Application migrations refuse production execution; that gate must be redesigned before a production cutover.
- Schedule-change notification prompts are parked; date changes can enqueue matching automation events, time-only changes do not. SMS cannot dispatch.

## Verified high-risk findings

1. OIDC auto-provisioning is unsafe: `roleForEmail()` assigns the broad legacy `admin` role to every unknown or missing email. Unknown external identities that pass OIDC therefore receive extensive CRM/finance/automation capabilities. Default to deny/invite-only or a minimal role.
2. Private-object authorization is not entity-bound. Attachment downloads are authorized by knowing the object path plus broad `/storage` access; object ACL enforcement is commented out. Upload URLs do not enforce the UI's file size/type promise, attachment registration is non-atomic with object upload, and deletes can leave leaked objects.
3. In-process schedulers are only singleton within one process. Autoscaled replicas can run automation/recurring cron simultaneously. Campaign/outbox DB claiming helps those workers, but all scheduled mutation engines need cross-instance locks/leases or a single worker deployment.
4. Stripe checkout marks an invoice paid but does not create a `payments` or allocation ledger row. Payment-based dashboard/reconciliation/accounting can therefore disagree with invoice status. Event handling is invoice-status-idempotent and the communication event is deduped by Stripe event ID, but accounting persistence is incomplete.
5. `GET /customers` returns `{customers,total,page,pageSize,totalPages}`, while its OpenAPI operation declares `Customer[]`. A separate `CustomerListResponse` schema exists and is generated but is not attached to that operation. The generated client is therefore wrong for this endpoint.
6. The OpenAPI file does not describe the complete runtime API. Static comparison found about 235 normalized runtime operations versus 181 OpenAPI operations; admin/import internals, calendar, attachments/storage, campaigns/templates, logs, profile, line items, and destructive/repair routes are among the hand-written-client areas.
7. `POST /activity-logs` accepts client-supplied actor/entity/action values, so those entries are not trustworthy audit records. Server-derived actors and bounded action/entity schemas are required for an audit trail.
8. Global 50 MB JSON and urlencoded parsers unnecessarily widen memory/DoS exposure. Scope large bodies to import routes.
9. CORS reflects arbitrary origins with credentials; there is no explicit CSRF token/origin allowlist. SameSite=Lax reduces but does not replace defense in depth.
10. The global error handler returns raw `Error.message`; internal/database details can leak.

## Maintainability and operations findings

- Largest handwritten files are multi-thousand-line pages/routes, especially `AdminImport.tsx`, `CustomerDetail.tsx`, jobs/import/customers routes, and import services. They mix state, transport, domain decisions, and rendering/query logic.
- Non-generated/test application code contains substantial explicit `any`/casts and a few `ts-ignore`/lint suppressions. Type safety is weakest in import code and fat pages/routes.
- There is no repository lint/format/coverage gate, no CI workflow, and no automated local PostgreSQL integration fixture.
- Test scripts enumerate paths manually, so a newly added test is silently skipped until the package script is updated.
- Required app migrations have immutable IDs/checksums, advisory locking, preflight, backup, apply, verify, and rollback. General Drizzle schema changes use schema push and have no checked-in chronological SQL migration history.
- `scripts/post-merge.sh` automatically runs schema push after install. The `db` filter currently resolves, but automatic push is operationally risky.
- `scripts/bump-version.sh` expects a missing root `clearview-crm-build-summary.html` although the public copy exists, so it currently fails.
- One-off import scripts and `seed.sql` contain destructive delete/truncate behavior; some paths are Replit-specific. They are not safe routine production tooling without explicit target validation and backups.
- Logging is inconsistent: Pino is configured, but many routes/import services use console logging and some import messages include customer-identifying values.
- The root pnpm guard uses Unix `sh`/`rm`, which is awkward on native Windows.
- README coverage is effectively absent; `replit.md` and some handoff docs are useful but partially stale.
- CRM and mockup duplicate UI primitives instead of sharing a design-system package. `Leads.tsx` appears unrouted/stale, and the object-storage library appears unused by the CRM.

## Verification baseline (2026-09-08)

- Root TypeScript project build: pass (`corepack pnpm@10 exec tsc --build`).
- API typecheck: pass. CRM typecheck: pass.
- API pretests: 26/26 pass. Main API tests: 395/410 pass; all 15 failures occur while loading DB-coupled modules because local `DATABASE_URL` is unset, not from executed assertions.
- CRM tests: 350/351 pass. The one failure is a Windows path-construction defect in `src/lib/auth-scope.test.ts` (`E:\\E:\\Projects...`).
- Mockup tests: 4/4 pass.
- No live database, deployed Replit, Stripe account, mail provider, or Google Cloud bucket was mutated or end-to-end tested during this analysis.

## Recommended order for future work

1. Fix unknown-OIDC role provisioning and add an authorization regression test.
2. Bind storage access to attachment entity permissions; enforce upload constraints and cleanup semantics.
3. Make Stripe webhooks create the canonical payment/allocation ledger transactionally.
4. Correct `/customers` OpenAPI, regenerate clients, then close the remaining route/spec gap.
5. Add cross-instance scheduler coordination and a production migration strategy before autoscale/Neon cutover.
6. Add CI with typecheck, automatic test discovery, lint/format, and a disposable PostgreSQL integration suite.
7. Incrementally split the largest routes/pages around existing pure-core boundaries; do not perform a big-bang rewrite.
