import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const applicationMigrationsTable = pgTable(
  "application_migrations",
  {
    migrationId: text("migration_id").primaryKey(),
    checksum: text("checksum").notNull(),
    environment: text("environment").notNull(),
    state: text("state").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    redactedSummary: jsonb("redacted_summary"),
    failureDetail: text("failure_detail"),
  },
  (t) => [
    check(
      "application_migrations_state_check",
      sql`${t.state} in ('running', 'applied', 'failed', 'rolled_back')`,
    ),
    check(
      "application_migrations_environment_check",
      sql`${t.environment} in ('sandbox', 'development', 'production', 'unknown')`,
    ),
    index("idx_application_migrations_state").on(t.state),
  ],
);

export const applicationMigrationBackupsTable = pgTable(
  "application_migration_backups",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    migrationId: text("migration_id").notNull(),
    backupKey: text("backup_key").notNull(),
    previousValues: jsonb("previous_values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_application_migration_backups_migration_key").on(
      t.migrationId,
      t.backupKey,
    ),
    index("idx_application_migration_backups_migration").on(t.migrationId),
  ],
);

// Retained Sandbox-only backup from the pre-framework lifecycle migration.
// Keep this separately modeled so Publish does not interpret it as a table
// replacement for the generic framework backup table.
export const sandboxLifecycleV1BackupTable = pgTable(
  "sandbox_lifecycle_v1_backup_20260815",
  {
    customerId: bigint("customer_id", { mode: "number" }).notNull(),
    previousLifecycleStatus: text("previous_lifecycle_status").notNull(),
    legacyStatus: text("legacy_status").notNull(),
    backedUpAt: timestamp("backed_up_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "sandbox_lifecycle_v1_backup_20260815_pkey",
      columns: [t.customerId],
    }),
  ],
);

export type ApplicationMigration = typeof applicationMigrationsTable.$inferSelect;
export type ApplicationMigrationBackup =
  typeof applicationMigrationBackupsTable.$inferSelect;
export type SandboxLifecycleV1Backup =
  typeof sandboxLifecycleV1BackupTable.$inferSelect;