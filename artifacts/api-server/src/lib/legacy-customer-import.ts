import { evaluateMigrationGate } from "../migrations/application-migrations.ts";

export const LEGACY_CUSTOMER_IMPORT_FLAG = "APP_LEGACY_CUSTOMER_IMPORT_ENABLED";
export const LEGACY_CUSTOMER_IMPORT_INVOCATION = "manual-cli";

export interface LegacyCustomerImportResult {
  customersCreated: number;
  jobsCreated: number;
  skipped: number;
}

export interface LegacyCustomerImportGate {
  enabled: boolean;
  authorizedSandbox: boolean;
  allowed: boolean;
  reason: string;
}

/**
 * The legacy file importer is an exceptional recovery tool, not startup
 * initialization. It is available only when the operator opts in and the
 * runtime proves it is the configured Sandbox.
 *
 * The migration gate is evaluated with its own enable switch forced on so
 * that this tool's clearly named flag remains the only opt-in for the
 * importer itself, while the gate still enforces Sandbox identity.
 */
export function evaluateLegacyCustomerImportGate(
  env: Record<string, string | undefined> = process.env,
): LegacyCustomerImportGate {
  const enabled = env[LEGACY_CUSTOMER_IMPORT_FLAG] === "true";
  const sandboxGate = evaluateMigrationGate({
    ...env,
    APP_MIGRATIONS_ENABLED: "true",
  });
  const authorizedSandbox = sandboxGate.eligible;

  if (!enabled) {
    return {
      enabled,
      authorizedSandbox,
      allowed: false,
      reason: `${LEGACY_CUSTOMER_IMPORT_FLAG} must be exactly "true"`,
    };
  }

  if (!authorizedSandbox) {
    return {
      enabled,
      authorizedSandbox,
      allowed: false,
      reason: `authorized Sandbox required: ${sandboxGate.reason}`,
    };
  }

  return {
    enabled,
    authorizedSandbox,
    allowed: true,
    reason: "authorized Sandbox legacy import",
  };
}

export interface LegacyCustomerImportOptions {
  invocation: string;
  env?: Record<string, string | undefined>;
  importer?: () => Promise<LegacyCustomerImportResult>;
}

/**
 * Deliberate invocation boundary for the legacy importer. Keeping the
 * invocation marker separate from environment configuration prevents merely
 * setting an environment variable from causing a startup import.
 */
export async function invokeLegacyCustomerImport(
  options: LegacyCustomerImportOptions,
) {
  if (options.invocation !== LEGACY_CUSTOMER_IMPORT_INVOCATION) {
    throw new Error(
      `Legacy Customer Factor import requires invocation "${LEGACY_CUSTOMER_IMPORT_INVOCATION}"`,
    );
  }

  const gate = evaluateLegacyCustomerImportGate(options.env);
  if (!gate.allowed) {
    throw new Error(`Legacy Customer Factor import denied: ${gate.reason}`);
  }

  if (options.importer) return options.importer();

  // Do not load the legacy file importer until both gates and the deliberate
  // invocation marker have passed. This keeps the default startup path inert.
  const { importCFDataFromFiles } = await import("./import-cf-file.ts");
  return importCFDataFromFiles();
}