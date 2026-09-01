import { createHash } from "node:crypto";
import type {
  MigrationContext,
  MigrationDefinition,
} from "./application-migrations.ts";

const MIGRATION_MANIFEST = [
  "team-users-rbac-v1",
  "add users.is_active boolean not null default true",
  "create case-insensitive unique username index",
  "preserve all existing user rows and session rows",
].join("\n");

export const TEAM_USERS_RBAC_V1_ID = "team-users-rbac-v1";
export const TEAM_USERS_RBAC_V1_CHECKSUM = createHash("sha256")
  .update(MIGRATION_MANIFEST)
  .digest("hex");

interface TeamUsersRbacPreflight {
  userCount: number;
  usernameConflictCount: number;
  isActiveColumnPresent: number;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key] ?? 0);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric migration result: ${key}`);
  }
  return value;
}

async function preflight(
  context: MigrationContext,
): Promise<TeamUsersRbacPreflight> {
  const users = await context.client.query("SELECT COUNT(*)::int AS count FROM users");
  const conflicts = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM (
         SELECT lower(trim(username)) AS normalized_username
           FROM users
          WHERE username IS NOT NULL
          GROUP BY lower(trim(username))
         HAVING COUNT(*) > 1
       ) conflicts`,
  );
  const column = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'is_active'`,
  );
  const result = {
    userCount: numberValue(users.rows[0] ?? {}, "count"),
    usernameConflictCount: numberValue(conflicts.rows[0] ?? {}, "count"),
    isActiveColumnPresent: numberValue(column.rows[0] ?? {}, "count"),
  };
  if (result.usernameConflictCount !== 0) {
    throw new Error("Cannot create case-insensitive username uniqueness: existing conflicts found");
  }
  return result;
}

async function backup(
  context: MigrationContext,
  preflightResult: TeamUsersRbacPreflight,
): Promise<Record<string, unknown>> {
  return {
    userCount: preflightResult.userCount,
    existingActiveColumn: preflightResult.isActiveColumnPresent === 1,
    dataRowsBackedUp: 0,
    sessionsUntouched: true,
  };
}

async function apply(context: MigrationContext): Promise<Record<string, unknown>> {
  await context.client.query(
    `ALTER TABLE users
       ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
  );
  await context.client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
       ON users (lower(username))
      WHERE username IS NOT NULL`,
  );
  return {
    addedIsActiveColumn: true,
    createdUsernameIndex: true,
    historicalUsersUpdated: 0,
  };
}

async function postflight(
  context: MigrationContext,
  preflightResult: TeamUsersRbacPreflight,
): Promise<Record<string, unknown>> {
  const checks = await context.client.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_active IS NULL)::int AS null_active,
       COUNT(*)::int AS user_count
       FROM users`,
  );
  const row = checks.rows[0] ?? {};
  const nullActive = numberValue(row, "null_active");
  const userCount = numberValue(row, "user_count");
  if (nullActive !== 0 || userCount !== preflightResult.userCount) {
    throw new Error("Team users RBAC migration changed existing user rows unexpectedly");
  }
  return {
    userCount,
    nullActive,
    historicalUsersUpdated: 0,
  };
}

async function verify(context: MigrationContext): Promise<Record<string, unknown>> {
  const column = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'is_active'`,
  );
  if (numberValue(column.rows[0] ?? {}, "count") !== 1) {
    throw new Error("users.is_active is missing");
  }
  const index = await context.client.query(
    `SELECT COUNT(*)::int AS count
       FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'users_username_lower_unique'`,
  );
  if (numberValue(index.rows[0] ?? {}, "count") !== 1) {
    throw new Error("Case-insensitive username index is missing");
  }
  return { isActiveColumnPresent: true, usernameIndexPresent: true };
}

async function rollback(context: MigrationContext): Promise<Record<string, unknown>> {
  await context.client.query("DROP INDEX IF EXISTS users_username_lower_unique");
  await context.client.query("ALTER TABLE users DROP COLUMN IF EXISTS is_active");
  return { removedIsActiveColumn: true, removedUsernameIndex: true };
}

export const teamUsersRbacV1Migration: MigrationDefinition<TeamUsersRbacPreflight> = {
  id: TEAM_USERS_RBAC_V1_ID,
  checksum: TEAM_USERS_RBAC_V1_CHECKSUM,
  description: "Add additive user activation state and case-insensitive local usernames",
  required: true,
  preflight,
  backup,
  apply,
  postflight,
  verify,
  rollback,
};