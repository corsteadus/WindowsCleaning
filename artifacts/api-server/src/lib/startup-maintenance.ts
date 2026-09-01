export function shouldRunLegacyStartupMaintenance(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LEGACY_STARTUP_MAINTENANCE_ENABLED === "true"
    && env.APP_MIGRATION_ENVIRONMENT === "sandbox"
    && Boolean(env.REPL_ID)
    && env.REPL_ID === env.APP_MIGRATION_SANDBOX_REPL_ID;
}

export function shouldStartMutationWorkers(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.APP_MIGRATION_ENVIRONMENT !== "sandbox") return true;
  return env.BACKGROUND_PROCESSING_ENABLED === "true"
    && Boolean(env.REPL_ID)
    && env.REPL_ID === env.APP_MIGRATION_SANDBOX_REPL_ID;
}