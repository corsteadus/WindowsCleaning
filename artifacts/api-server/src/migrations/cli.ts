import { pool } from "@workspace/db";
import {
  accountLifecycleV1Migration,
} from "./account-lifecycle-v1.ts";
import {
  evaluateMigrationGate,
  getMigrationStatus,
  REQUIRED_MIGRATIONS,
  rollbackMigration,
  runMigration,
  verifyMigration,
  type MigrationEnvironment,
} from "./application-migrations.ts";
import {
  invokeLegacyCustomerImport,
  LEGACY_CUSTOMER_IMPORT_INVOCATION,
} from "../lib/legacy-customer-import.ts";

function currentEnvironment(): MigrationEnvironment {
  const value = process.env.APP_MIGRATION_ENVIRONMENT?.trim().toLowerCase();
  if (
    value === "sandbox" ||
    value === "development" ||
    value === "production"
  ) {
    return value;
  }
  return "unknown";
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, migrationId, confirmationFlag] = process.argv.slice(2);
  const migration =
    REQUIRED_MIGRATIONS.find((candidate) => candidate.id === migrationId) ??
    accountLifecycleV1Migration;
  const environment = currentEnvironment();

  switch (command) {
    case "status":
      print(await getMigrationStatus({ connect: () => pool.connect() }));
      return;
    case "verify":
      print(
        await verifyMigration(migration, {
          pool: { connect: () => pool.connect() },
          environment,
        }),
      );
      return;
    case "run":
      print(
        await runMigration(migration, {
          pool: { connect: () => pool.connect() },
          environment,
          gate: evaluateMigrationGate(),
        }),
      );
      return;
    case "rollback":
      if (confirmationFlag !== "--confirm") {
        throw new Error(
          `Rollback requires: rollback ${migration.id} --confirm`,
        );
      }
      print(
        await rollbackMigration(migration, {
          pool: { connect: () => pool.connect() },
          environment,
          gate: evaluateMigrationGate(),
          confirmation: migration.id,
        }),
      );
      return;
    case "legacy-customer-import":
      print(
        await invokeLegacyCustomerImport({
          invocation: LEGACY_CUSTOMER_IMPORT_INVOCATION,
        }),
      );
      return;
    default:
      throw new Error(
        "Usage: status | verify [migration-id] | run [migration-id] | rollback [migration-id] --confirm | legacy-customer-import",
      );
  }
}

main()
  .catch((error: unknown) => {
    print({
      ok: false,
      error: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Migration command failed",
    });
    process.exitCode = 1;
  })
  .finally(() => pool.end());