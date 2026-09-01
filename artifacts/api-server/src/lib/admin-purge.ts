import { sql } from "drizzle-orm";
/** This value is deliberately distinct from seed confirmation. */
export const SANDBOX_PURGE_CONFIRMATION = "PURGE_SANDBOX_DATA";

export interface SandboxPurgeGate {
  authorizedSandbox: boolean;
  confirmationMatches: boolean;
  allowed: boolean;
  reason: string;
}

/**
 * Purge is independently opt-in.  In particular, do not make a disabled
 * migration switch an accidental authorization to destroy data.  We reuse the
 * migration identity attestation after checking this operation's own switch.
 */
export function evaluateSandboxPurgeGate(
  env: Record<string, string | undefined> = process.env,
  confirmation: unknown,
): SandboxPurgeGate {
  const confirmationMatches = confirmation === SANDBOX_PURGE_CONFIRMATION;
  if (env.APP_PURGE_ENABLED !== "true") {
    return {
      authorizedSandbox: false,
      confirmationMatches,
      allowed: false,
      reason: "disabled",
    };
  }

  const declaredEnvironment = env.APP_MIGRATION_ENVIRONMENT?.trim().toLowerCase();
  const runtimeReplId = env.REPL_ID?.trim();
  const configuredSandboxReplId = env.APP_MIGRATION_SANDBOX_REPL_ID?.trim();
  if (
    declaredEnvironment !== "sandbox"
    || !runtimeReplId
    || !configuredSandboxReplId
    || runtimeReplId !== configuredSandboxReplId
  ) {
    return {
      authorizedSandbox: false,
      confirmationMatches,
      allowed: false,
      reason: "authorized Sandbox requires exact runtime and configured Repl identity",
    };
  }
  if (!confirmationMatches) {
    return {
      authorizedSandbox: true,
      confirmationMatches: false,
      allowed: false,
      reason: `confirmation must exactly match ${SANDBOX_PURGE_CONFIRMATION}`,
    };
  }
  return {
    authorizedSandbox: true,
    confirmationMatches: true,
    allowed: true,
    reason: "authorized Sandbox purge",
  };
}

export interface PurgeExecutor {
  // Drizzle's execute accepts SQL wrappers; `any` intentionally keeps this
  // small adapter structurally compatible with both Drizzle and test doubles.
  execute(statement: any): Promise<unknown>;
}

export interface PurgeDatabase extends PurgeExecutor {
  transaction<T>(work: (tx: PurgeExecutor) => Promise<T>): Promise<T>;
}

/**
 * Keep this list explicit rather than using TRUNCATE/CASCADE: this protects
 * user and Office-owned tables from a future foreign key being swept in.
 * Children must precede their parents; notably crew_members precedes crews.
 */
const PURGE_DELETE_TABLES = [
  "message_logs",
  "automation_rules",
  "tasks",
  "quote_line_items",
  "invoices",
  "jobs",
  "recurring_plans",
  "quotes",
  "contacts",
  "properties",
  "leads",
  "customers",
  "crew_members",
  "crews",
  "services",
] as const;

const PURGE_SEQUENCES = [
  "leads_id_seq", "customers_id_seq", "contacts_id_seq", "properties_id_seq",
  "services_id_seq", "quotes_id_seq", "quote_line_items_id_seq", "jobs_id_seq",
  "invoices_id_seq", "crews_id_seq", "recurring_plans_id_seq", "tasks_id_seq",
  "automation_rules_id_seq", "message_logs_id_seq",
] as const;

export async function purgeSandboxCrmData(database: PurgeDatabase): Promise<void> {
  await database.transaction(async (tx) => {
    for (const table of PURGE_DELETE_TABLES) {
      await tx.execute(sql.raw(`DELETE FROM ${table}`));
    }
    for (const sequence of PURGE_SEQUENCES) {
      await tx.execute(sql.raw(`ALTER SEQUENCE IF EXISTS ${sequence} RESTART WITH 1`));
    }
  });
}

/**
 * Keep authorization and side effects coupled for callers and tests: denied
 * requests cannot even obtain the transactional callback.
 */
export async function runSandboxPurge(
  database: PurgeDatabase,
  env: Record<string, string | undefined>,
  confirmation: unknown,
): Promise<SandboxPurgeGate> {
  const gate = evaluateSandboxPurgeGate(env, confirmation);
  if (!gate.allowed) return gate;
  await purgeSandboxCrmData(database);
  return gate;
}

export const sandboxPurgeDeleteOrder = PURGE_DELETE_TABLES;