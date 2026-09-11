import { accountLifecycleV1Migration } from "./account-lifecycle-v1.ts";
import { invoicePropertiesV1Migration } from "./invoice-properties-v1.ts";
import { propertiesContactsV1Migration } from "./properties-contacts-v1.ts";
import { teamUsersRbacV1Migration } from "./team-users-rbac-v1.ts";
import { profileDetailsCatalogsV1Migration } from "./profile-details-catalogs-v1.ts";
import { estimateLifecycleV1Migration } from "./estimate-lifecycle-v1.ts";
import { dashboardReportingIndexesV1Migration } from "./dashboard-reporting-indexes-v1.ts";
import { crewAssignmentGraphV1Migration } from "./crew-assignment-graph-v1.ts";
import { calendarScheduleEntriesV1Migration } from "./calendar-schedule-entries-v1.ts";
import { calendarQueueEntriesV1Migration } from "./calendar-queue-entries-v1.ts";

export type MigrationEnvironment =
  | "sandbox"
  | "development"
  | "production"
  | "unknown";

export type MigrationState = "running" | "applied" | "failed" | "rolled_back";

export interface MigrationQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface MigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<MigrationQueryResult>;
  release?: () => void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface MigrationContext {
  client: MigrationClient;
  environment: MigrationEnvironment;
  migrationId: string;
}

export interface MigrationDefinition<Preflight = unknown> {
  id: string;
  checksum: string;
  description: string;
  required: boolean;
  preflight(context: MigrationContext): Promise<Preflight>;
  backup(context: MigrationContext, preflight: Preflight): Promise<Record<string, unknown>>;
  apply(context: MigrationContext, preflight: Preflight): Promise<Record<string, unknown>>;
  postflight(
    context: MigrationContext,
    preflight: Preflight,
  ): Promise<Record<string, unknown>>;
  verify(context: MigrationContext): Promise<Record<string, unknown>>;
  rollback(context: MigrationContext): Promise<Record<string, unknown>>;
}

export interface MigrationGate {
  enabled: boolean;
  eligible: boolean;
  declaredEnvironment: string | null;
  runtimeReplId: string | null;
  configuredSandboxReplId: string | null;
  reason: string;
}

export interface MigrationRunResult {
  migrationId: string;
  state: MigrationState;
  skipped: boolean;
  summary?: Record<string, unknown>;
}

export const MIGRATION_LOCK_CLASS_ID = 3;
export const MIGRATION_LOCK_ID = 1;
export const REQUIRED_MIGRATIONS = [
  accountLifecycleV1Migration,
  propertiesContactsV1Migration,
  invoicePropertiesV1Migration,
  teamUsersRbacV1Migration,
  profileDetailsCatalogsV1Migration,
  estimateLifecycleV1Migration,
  dashboardReportingIndexesV1Migration,
  crewAssignmentGraphV1Migration,
  calendarScheduleEntriesV1Migration,
  calendarQueueEntriesV1Migration,
] as const;

export class MigrationGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationGateError";
  }
}

export class MigrationIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationIdentityError";
  }
}

export function evaluateMigrationGate(
  env: Record<string, string | undefined> = process.env,
): MigrationGate {
  const enabled = env.APP_MIGRATIONS_ENABLED === "true";
  const declaredEnvironment = env.APP_MIGRATION_ENVIRONMENT?.trim().toLowerCase() || null;
  const runtimeReplId = env.REPL_ID?.trim() || null;
  const configuredSandboxReplId =
    env.APP_MIGRATION_SANDBOX_REPL_ID?.trim() || null;
  const configuredSandboxDomain =
    env.APP_MIGRATION_SANDBOX_DOMAIN?.trim().toLowerCase() || null;
  const runtimeDomains = new Set(
    (env.REPLIT_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0])
      .filter(Boolean),
  );
  const sandboxDomainAttested =
    configuredSandboxDomain !== null &&
    runtimeDomains.has(configuredSandboxDomain);

  if (!enabled) {
    return {
      enabled: false,
      eligible: false,
      declaredEnvironment,
      runtimeReplId,
      configuredSandboxReplId,
      reason: "disabled",
    };
  }

  if (declaredEnvironment !== "sandbox") {
    return {
      enabled: true,
      eligible: false,
      declaredEnvironment,
      runtimeReplId,
      configuredSandboxReplId,
      reason: "declared environment is not sandbox",
    };
  }

  if (!configuredSandboxReplId) {
    return {
      enabled: true,
      eligible: false,
      declaredEnvironment,
      runtimeReplId,
      configuredSandboxReplId,
      reason: "Sandbox Repl identity is incomplete",
    };
  }

  if (!runtimeReplId) {
    if (sandboxDomainAttested) {
      return {
        enabled: true,
        eligible: true,
        declaredEnvironment,
        runtimeReplId,
        configuredSandboxReplId,
        reason: "eligible Sandbox deployment domain",
      };
    }
    return {
      enabled: true,
      eligible: false,
      declaredEnvironment,
      runtimeReplId,
      configuredSandboxReplId,
      reason: "Sandbox Repl identity is incomplete",
    };
  }

  if (runtimeReplId !== configuredSandboxReplId) {
    if (sandboxDomainAttested) {
      return {
        enabled: true,
        eligible: true,
        declaredEnvironment,
        runtimeReplId,
        configuredSandboxReplId,
        reason: "eligible Sandbox deployment domain",
      };
    }
    return {
      enabled: true,
      eligible: false,
      declaredEnvironment,
      runtimeReplId,
      configuredSandboxReplId,
      reason: "runtime Repl identity does not match the configured Sandbox Repl",
    };
  }

  return {
    enabled: true,
    eligible: true,
    declaredEnvironment,
    runtimeReplId,
    configuredSandboxReplId,
    reason: "eligible Sandbox Repl",
  };
}

async function acquireMigrationLock(client: MigrationClient): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock($1::int, $2::int)",
    [MIGRATION_LOCK_CLASS_ID, MIGRATION_LOCK_ID],
  );
}

async function findLedgerRow(
  client: MigrationClient,
  migrationId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT migration_id, checksum, environment, state
       FROM application_migrations
      WHERE migration_id = $1
      FOR UPDATE`,
    [migrationId],
  );
  return result.rows[0] ?? null;
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Migration ledger field ${key} is invalid`);
  }
  return value;
}

function assertLedgerIdentity(
  row: Record<string, unknown>,
  migration: MigrationDefinition,
  environment: MigrationEnvironment,
): void {
  const storedChecksum = requireString(row, "checksum");
  const storedEnvironment = requireString(row, "environment");
  if (storedChecksum !== migration.checksum) {
    throw new MigrationIdentityError(
      `Checksum drift detected for ${migration.id}`,
    );
  }
  if (storedEnvironment !== environment) {
    throw new MigrationIdentityError(
      `Environment drift detected for ${migration.id}`,
    );
  }
}

async function insertRunningLedgerRow(
  client: MigrationClient,
  migration: MigrationDefinition,
  environment: MigrationEnvironment,
  existing: Record<string, unknown> | null,
): Promise<void> {
  if (existing) {
    assertLedgerIdentity(existing, migration, environment);
    await client.query(
      `UPDATE application_migrations
          SET state = 'running',
              started_at = NOW(),
              completed_at = NULL,
              updated_at = NOW(),
              redacted_summary = NULL,
              failure_detail = NULL
        WHERE migration_id = $1`,
      [migration.id],
    );
    return;
  }

  await client.query(
    `INSERT INTO application_migrations
      (migration_id, checksum, environment, state, started_at, updated_at)
     VALUES ($1, $2, $3, 'running', NOW(), NOW())`,
    [migration.id, migration.checksum, environment],
  );
}

function migrationFailureDetail(stage: string): string {
  return `${stage}_failed`;
}

async function persistFailure(
  client: MigrationClient,
  migration: MigrationDefinition,
  environment: MigrationEnvironment,
  stage: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await acquireMigrationLock(client);
    const existing = await findLedgerRow(client, migration.id);
    if (existing) {
      assertLedgerIdentity(existing, migration, environment);
      await client.query(
        `UPDATE application_migrations
            SET state = 'failed',
                updated_at = NOW(),
                completed_at = NOW(),
                failure_detail = $2
          WHERE migration_id = $1`,
        [migration.id, migrationFailureDetail(stage)],
      );
    } else {
      await client.query(
        `INSERT INTO application_migrations
          (migration_id, checksum, environment, state, started_at, completed_at, updated_at, failure_detail)
         VALUES ($1, $2, $3, 'failed', NOW(), NOW(), NOW(), $4)`,
        [
          migration.id,
          migration.checksum,
          environment,
          migrationFailureDetail(stage),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runMigration(
  migration: MigrationDefinition,
  options: {
    pool: MigrationPool;
    environment: MigrationEnvironment;
    gate?: MigrationGate;
  },
): Promise<MigrationRunResult> {
  const gate = options.gate ?? evaluateMigrationGate();
  if (!gate.eligible) {
    throw new MigrationGateError(`Migration execution denied: ${gate.reason}`);
  }

  const client = await options.pool.connect();
  let stage = "lock";
  try {
    await client.query("BEGIN");
    await acquireMigrationLock(client);

    const existing = await findLedgerRow(client, migration.id);
    if (existing) {
      assertLedgerIdentity(existing, migration, options.environment);
      const state = requireString(existing, "state") as MigrationState;
      if (state === "applied") {
        await client.query("COMMIT");
        return {
          migrationId: migration.id,
          state: "applied",
          skipped: true,
        };
      }
    }

    await insertRunningLedgerRow(
      client,
      migration,
      options.environment,
      existing,
    );

    stage = "preflight";
    const preflight = await migration.preflight({
      client,
      environment: options.environment,
      migrationId: migration.id,
    });

    stage = "backup";
    const backupSummary = await migration.backup(
      { client, environment: options.environment, migrationId: migration.id },
      preflight,
    );

    stage = "apply";
    const applySummary = await migration.apply(
      { client, environment: options.environment, migrationId: migration.id },
      preflight,
    );

    stage = "postflight";
    const postflightSummary = await migration.postflight(
      { client, environment: options.environment, migrationId: migration.id },
      preflight,
    );
    const summary = {
      migration: migration.description,
      backup: backupSummary,
      apply: applySummary,
      postflight: postflightSummary,
    };

    await client.query(
      `UPDATE application_migrations
          SET state = 'applied',
              completed_at = NOW(),
              updated_at = NOW(),
              redacted_summary = $2,
              failure_detail = NULL
        WHERE migration_id = $1`,
      [migration.id, JSON.stringify(summary)],
    );
    await client.query("COMMIT");
    return {
      migrationId: migration.id,
      state: "applied",
      skipped: false,
      summary,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (!(error instanceof MigrationIdentityError)) {
      await persistFailure(
        client,
        migration,
        options.environment,
        stage,
      ).catch(() => {});
    }
    throw error;
  } finally {
    client.release?.();
  }
}

export async function getMigrationStatus(
  pool: MigrationPool,
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT migration_id, checksum, environment, state,
              started_at, completed_at, updated_at,
              redacted_summary, failure_detail
         FROM application_migrations
        ORDER BY migration_id`,
    );
    return {
      gate: (() => {
        const gate = evaluateMigrationGate();
        return {
          enabled: gate.enabled,
          eligible: gate.eligible,
          declaredEnvironment: gate.declaredEnvironment,
          reason: gate.reason,
        };
      })(),
      migrations: result.rows,
    };
  } finally {
    client.release?.();
  }
}

export async function verifyMigration(
  migration: MigrationDefinition,
  options: { pool: MigrationPool; environment: MigrationEnvironment },
): Promise<Record<string, unknown>> {
  const client = await options.pool.connect();
  try {
    return migration.verify({
      client,
      environment: options.environment,
      migrationId: migration.id,
    });
  } finally {
    client.release?.();
  }
}

export async function rollbackMigration(
  migration: MigrationDefinition,
  options: {
    pool: MigrationPool;
    environment: MigrationEnvironment;
    gate?: MigrationGate;
    confirmation: string;
  },
): Promise<Record<string, unknown>> {
  const gate = options.gate ?? evaluateMigrationGate();
  if (!gate.eligible) {
    throw new MigrationGateError(`Migration rollback denied: ${gate.reason}`);
  }
  if (options.confirmation !== migration.id) {
    throw new MigrationGateError(
      `Rollback confirmation must exactly match ${migration.id}`,
    );
  }

  const client = await options.pool.connect();
  try {
    await client.query("BEGIN");
    await acquireMigrationLock(client);
    const existing = await findLedgerRow(client, migration.id);
    if (!existing) throw new Error(`Migration ${migration.id} is not recorded`);
    assertLedgerIdentity(existing, migration, options.environment);
    if (requireString(existing, "state") !== "applied") {
      throw new Error(`Migration ${migration.id} is not applied`);
    }

    const summary = await migration.rollback({
      client,
      environment: options.environment,
      migrationId: migration.id,
    });
    await client.query(
      `UPDATE application_migrations
          SET state = 'rolled_back',
              completed_at = NOW(),
              updated_at = NOW(),
              redacted_summary = $2,
              failure_detail = NULL
        WHERE migration_id = $1`,
      [migration.id, JSON.stringify({ rollback: summary })],
    );
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

export async function runRequiredMigrationsAtStartup(
  pool: MigrationPool,
  providedGate?: MigrationGate,
): Promise<{ status: "disabled" | "applied"; reason?: string }> {
  const gate = providedGate ?? evaluateMigrationGate();
  if (!gate.enabled) {
    return { status: "disabled", reason: gate.reason };
  }
  if (!gate.eligible) {
    throw new MigrationGateError(
      `Required migrations refused to start: ${gate.reason}`,
    );
  }

  for (const migration of REQUIRED_MIGRATIONS) {
    await runMigration(migration, {
      pool,
      environment: "sandbox",
      gate,
    });
  }
  return { status: "applied" };
}