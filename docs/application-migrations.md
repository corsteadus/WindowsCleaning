# Application data migrations

This repository has a durable, versioned application-data migration framework
for the Window Cleaning CRM. It is intentionally separate from Drizzle schema
changes.

## Safety model

- Migrations are disabled unless `APP_MIGRATIONS_ENABLED=true`.
- An enabled migration must also declare `APP_MIGRATION_ENVIRONMENT=sandbox`.
- The runtime `REPL_ID` must exactly match
  `APP_MIGRATION_SANDBOX_REPL_ID`.
- If a published artifact does not expose a stable runtime `REPL_ID`, the
  exact `REPLIT_DOMAINS` value must match the configured
  `APP_MIGRATION_SANDBOX_DOMAIN` attestation.
- Production defaults to disabled. A copied checkout cannot run automatically
  in another Replit because neither its runtime `REPL_ID` nor its runtime
  domain will match the Sandbox allowlist.
- Startup fails closed only when the explicit gate is enabled but invalid, or
  when an eligible Sandbox migration fails. Normal production startup remains
  unchanged while the gate is disabled.
- Legacy repair/import-resume startup work is disabled unless
  `LEGACY_STARTUP_MAINTENANCE_ENABLED=true` and the same Sandbox environment and
  Repl identity checks pass.
- In a declared Sandbox, state-changing campaign, automation, and recurring-plan
  workers are disabled unless `BACKGROUND_PROCESSING_ENABLED=true` and the same
  Repl identity checks pass. Non-Sandbox environments preserve normal worker
  startup.
- The runner serializes all migrations with the two-integer PostgreSQL
  advisory-lock namespace `(3, 1)`.

The ledger records the immutable migration ID and checksum, target environment,
state, timestamps, redacted summary, and redacted failure detail. A successful
transaction includes preflight, backup, apply, and postflight. If any step
fails, customer updates and backup rows roll back together; the failed ledger
state is persisted in a separate transaction.

## Commands

Run from the repository root. These commands are CLI-only and do not expose
customer data.

```sh
pnpm --filter @workspace/api-server run migration:status
pnpm --filter @workspace/api-server run migration:verify -- account-lifecycle-v1
pnpm --filter @workspace/api-server run migration:run -- account-lifecycle-v1
pnpm --filter @workspace/api-server run migration:rollback -- account-lifecycle-v1 --confirm
```

`run` and `rollback` require the explicit Sandbox gate. `status` and `verify`
are read-only. Rollback is guarded by both the Sandbox identity check and an
exact migration-ID confirmation.

## Account Lifecycle v1

`account-lifecycle-v1` backs up every customer ID, legacy `status`, and prior
`lifecycle_status` in `application_migration_backups`. It deterministically
maps legacy `active` to canonical `customer` and preserves the other supported
legacy lifecycle values. It updates only rows whose canonical value differs,
then verifies:

- zero unsupported or null lifecycle/status/account-type values,
- zero canonical/legacy mismatches,
- zero dangling audited customer references, and
- a complete, distinct backup key set.

The backup table is generic and migration-scoped. It does not alter or remove
the existing dated Sandbox backup table
`sandbox_lifecycle_v1_backup_20260815`.

## Schema and operational procedure

The ledger and backup tables are defined in
`lib/db/src/schema/application_migrations.ts`. Apply that schema through the
existing development-only Drizzle workflow before enabling startup execution.
Do not use the migration CLI against the separate Production-Window-Shine-Manager
Replit, and do not run direct agent SQL against the published database.

For a future Sandbox release:

1. Apply and verify the development schema.
2. Run the full API tests, typecheck, build, and workflow smoke checks.
3. Confirm `migration:status` and `migration:verify` are redacted and read-only.
4. Create a named checkpoint.
5. Publish the current Sandbox Replit through the supported Replit flow.
6. If rollback is required, stop serving traffic first, preserve the ledger and
   backup rows, and run the guarded rollback command from the same identified
   Sandbox Replit. Verify afterward before resuming service.

Leave both startup mutation flags unset for a Data Free Sandbox. Enabling either
flag is an operational action, not part of ordinary application startup.

Never edit a stored migration checksum. A code change to a migration requires a
new migration ID rather than mutating an applied migration.