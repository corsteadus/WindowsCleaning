# CRM feedback implementation matrix — 2026-08-29

This matrix records the reconciled final state of the numbered feedback package.
`Verified` means the implementation and executable domain, route, or UI
regressions cover the requirement. The cross-phase journey is exercised without
a live-database fixture so the Data Free database remains untouched. External
delivery remains intentionally provider-dependent.

| # | Requirement | Status | Dependencies / disposition |
|---:|---|---|---|
| 1 | Remove Dashboard New Customer and New Estimate shortcuts | Verified | Dashboard retains Create Job; customer/estimate creation remains profile-scoped. |
| 2 | Rename Leads to Prospects while retaining safe compatibility | Verified | Prospect UI and aliases are canonical; legacy lead-backed integration routes remain compatible. |
| 3 | Remove standalone Email navigation | Verified | Communication APIs remain available only through contextual workflows. |
| 4 | Remove standalone Payments navigation | Verified | Payment recording remains invoice-contextual. |
| 5 | Dashboard reporting filters and comparisons | Verified | Five periods, prior-period comparisons, auditable decision/conversion rules, cash sales, and receivables are covered. |
| 6 | One shared Prospect/Customer profile identity and lifecycle | Verified | Canonical customers table and lifecycle conversion are reused; no duplicate Prospect identity exists. |
| 7 | Residential and Commercial templates over shared profile | Verified | Shared profile model uses account-type-specific fields without separate identity tables. |
| 8 | Multiple service/job locations | Verified | Property ownership/relationships and per-location estimate conversion are covered. |
| 9 | Unlimited labeled contacts and purpose-based recipients | Verified with decision | Labeled contacts and purposes are implemented. Automatic purpose-recipient expansion remains a business-policy decision; sends use explicit server-resolved recipients. |
| 10 | Admin-managed catalogs | Verified | Profile catalogs and role-gated administration are implemented with a registered migration. |
| 11 | Exemptions, payment terms, marketing source, custom fields | Verified | Profile details, catalogs, and custom-field definitions/values are covered. |
| 12 | Separate profile, location, estimate, and job notes | Verified | Distinct fields and snapshots preserve each note domain. |
| 13 | Prospects can create/open full profiles; no completed work pre-conversion | Verified | Prospect profiles share the full account UI; lifecycle rules prevent completed work before conversion. |
| 14 | Schedule an Estimate from a Prospect | Verified | Estimate appointments support Prospect profiles and locations. |
| 15 | Finalize and deliver estimates | Verified with adapter | Finalization, immutable revisions, delivery requests, and outbox are covered; real email/SMS delivery requires provider credentials. |
| 16 | Secure estimate links and activity tracking | Verified | Bounded hashed tokens, expiry, redacted logs, request limiting, deduped activity, and abuse guards are covered. |
| 17 | Estimate status model | Verified | Lifecycle derivation and terminal-state behavior are covered. |
| 18 | Customer-facing accept/decline | Verified | Latest-revision enforcement, idempotent decisions, immutable snapshot, and customer audit actor are covered. |
| 19 | Authorized conversion and job scheduling | Verified | Composite capability checks and transaction-scoped conversion create one job per selected location. |
| 20 | Locked accepted-estimate snapshots | Verified | Accepted revision snapshot and terms are immutable; later work requires a new revision. |
| 21 | Direct customer creation and initial-job workflow | Verified | Shared creation flow supports contact, location, profile details, and optional initial job. |
| 22 | Atomic customer plus initial job save | Verified | Composite transaction, rollback behavior, and exact idempotent replay are covered. |
| 23 | Customer profile as operational hub | Verified | Estimates, jobs, invoices, payments, files, contacts, properties, and masked communications are profile-centered. |
| 24 | Existing customers create additional estimates | Verified | Existing profiles expose estimate creation without account duplication. |
| 25 | Job lifecycle through invoice and payment | Verified | Conversion, completion, invoice generation, payment recording, retries, and financial snapshots are covered. |
| 26 | Actor/timestamp auditability and permissions | Verified | Server-derived actors, immutable timestamps, composite RBAC, and financial/communication restrictions are covered. |
| 27 | Safe migrations, contracts, states, tests, compatibility | Verified | Required migrations are registered and guarded; OpenAPI clients are generated and test allowlists are explicit. |
| 28 | No demo records, imports, repair jobs, or credentials | Verified | Demo seed is disabled and legacy repair/import-resume startup work is default-off plus Sandbox-identity-gated. |
| 29 | Sandbox 2 production fail-closed/read-only | Verified | No publication or live mutation occurred; production and wrong-Repl migration execution fail closed. |
| 30 | Run gates and report scope honestly | Verified | Final non-production gates and limitations are recorded in the regression handoff report. |

## Dependency map

- **A — gap matrix:** this document.
- **B — navigation and shared profile compatibility:** completed in Task #11.
- **C — locations, contacts, catalogs, settings, and custom fields:** profile/catalog task;
  existing location/contact primitives are retained without duplication.
- **D — Prospect estimate scheduling, delivery, status, and decisions:** estimate lifecycle
  task and communication work.
- **E — manual conversion and job scheduling:** estimate conversion scheduling task.
- **F — enhanced Customer profile and atomic creation:** customer operations task.
- **G — dashboard metrics and final regression gate:** dashboard reporting and CRM regression
  tasks.

## Safety boundary

Only the Sandbox 2 codebase is changed. This task does not seed or import records, write to
production, migrate production, publish, or alter the existing read-only/fail-closed runtime
protections.