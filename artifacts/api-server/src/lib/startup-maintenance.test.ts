import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunLegacyStartupMaintenance, shouldStartMutationWorkers } from "./startup-maintenance.ts";

test("legacy repair and import-resume startup work is disabled by default", () => {
  assert.equal(shouldRunLegacyStartupMaintenance({}), false);
  assert.equal(shouldRunLegacyStartupMaintenance({ NODE_ENV: "production" }), false);
});

test("state-changing background workers are disabled unless explicitly Sandbox-attested", () => {
  assert.equal(shouldStartMutationWorkers({}), true);
  assert.equal(shouldStartMutationWorkers({
    APP_MIGRATION_ENVIRONMENT: "production",
  }), true);
  assert.equal(shouldStartMutationWorkers({
    APP_MIGRATION_ENVIRONMENT: "sandbox",
  }), false);
  assert.equal(shouldStartMutationWorkers({
    BACKGROUND_PROCESSING_ENABLED: "true",
    APP_MIGRATION_ENVIRONMENT: "sandbox",
    REPL_ID: "sandbox-2",
    APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-2",
  }), true);
});

test("legacy startup maintenance requires explicit matching Sandbox identity", () => {
  const base = {
    LEGACY_STARTUP_MAINTENANCE_ENABLED: "true",
    APP_MIGRATION_ENVIRONMENT: "sandbox",
    REPL_ID: "sandbox-2",
  };
  assert.equal(shouldRunLegacyStartupMaintenance(base), false);
  assert.equal(shouldRunLegacyStartupMaintenance({
    ...base,
    APP_MIGRATION_SANDBOX_REPL_ID: "other-repl",
  }), false);
  assert.equal(shouldRunLegacyStartupMaintenance({
    ...base,
    APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-2",
  }), true);
});