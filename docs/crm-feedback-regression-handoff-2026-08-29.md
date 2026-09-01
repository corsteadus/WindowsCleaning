# CRM feedback regression handoff — 2026-08-29

## Scope and outcome

All 30 feedback rows were reconciled in `docs/feedback-implementation-2026-08-29.md`.
The executable cross-phase regression covers Prospect lifecycle, estimate
scheduling/finalization/delivery/decision rules, per-location conversion
planning, job completion, invoice generation, payment, and concurrent replay.
Atomic customer plus initial-job tests cover every staged rollback point and
exact idempotent replay.

No production environment, deployment setting, other Repl, or published artifact
was touched. No Sandbox record was created, changed, or deleted. No publication
was performed.

## Safety and security verification

- Public estimate tokens are format-bounded and hashed before lookup.
- Public estimate requests have separate bounded IP-wide and token-specific
  fixed-window limits with expired-key cleanup.
- Estimate decisions reject superseded revisions, are irreversible but
  idempotent, and retain the accepted revision snapshot.
- Server-side capabilities cover estimate conversion, customer-plus-job
  composite writes, financial reporting, communications, and administration.
- Actors and timestamps are server-derived at mutation boundaries.
- Legacy repair/import-resume startup work is default-off and requires explicit
  matching Sandbox identity.
- In the declared Sandbox, state-changing campaign, automation, and
  recurring-plan workers are default-off and require explicit matching Sandbox
  identity. Non-Sandbox environments preserve normal worker startup.
- Demo seed/import tests and migration-gate tests retain fail-closed behavior.

## Contract and build gates

- OpenAPI generation completed with identical generated-file checksums before
  and after generation.
- Shared TypeScript project build passed.
- API typecheck and production build passed.
- CRM typecheck and production build passed.
- API standard suite passed: 384 tests.
- API pretest regression gate passed: 23 checks.
- API focused profile, customer hub, and dashboard suites passed.
- CRM standard suite passed: 225 tests.
- CRM focused profile, customer hub, dashboard, and estimate lifecycle suites passed.
- `git diff --check` passed.

The CRM build retains existing non-fatal sourcemap and large-chunk warnings.

## Application migrations

Required migration definitions:

1. `account-lifecycle-v1`
2. `properties-contacts-v1`
3. `invoice-properties-v1`
4. `team-users-rbac-v1`
5. `profile-details-catalogs-v1`
6. `estimate-lifecycle-v1`
7. `dashboard-reporting-indexes-v1`

Read-only migration status confirmed the execution gate is disabled. The ledger
reports the account lifecycle, profile/catalog, and estimate lifecycle
migrations applied with zero seeded or rewritten historical rows. No migration
was run by this task. Remaining registered migrations must follow the documented
explicit Sandbox-gated operational procedure if ever needed.

## External credentials and decisions

- Real email/SMS estimate delivery requires a configured provider. The Sandbox
  safely records `provider_unconfigured` delivery requests instead of inventing
  credentials or claiming delivery.
- Stripe or other external payment processing requires provider configuration;
  manual invoice payment recording is covered without external credentials.
- Automatic expansion from contact-purpose labels to recipients remains a
  business-policy decision. Current sends use explicit, server-resolved
  recipients and communication-safety checks.

## Live non-mutating checks

Only health/auth/not-found/invalid paths, the unauthenticated sign-in surface,
the persistent `SANDBOX 2 DATA FREE` label, and data-free counts are eligible for
live verification. Successful mutation paths remain covered by executable
in-memory/domain/route tests rather than live fixture writes.

The final live smoke returned `200` for health, `200 {"user":null}` for the auth
envelope, `401` for protected dashboard requests, and the generic `404` response
for a syntactically valid but nonexistent public estimate token. Fresh startup
logs confirmed migrations, legacy maintenance, and state-changing background
workers were disabled. The browser console contained only normal Vite connection
messages.