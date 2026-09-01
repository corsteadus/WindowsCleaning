import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateLegacyCustomerImportGate,
  invokeLegacyCustomerImport,
  LEGACY_CUSTOMER_IMPORT_FLAG,
  LEGACY_CUSTOMER_IMPORT_INVOCATION,
} from "./legacy-customer-import.ts";

const sandboxEnv = {
  [LEGACY_CUSTOMER_IMPORT_FLAG]: "true",
  APP_MIGRATION_ENVIRONMENT: "sandbox",
  REPL_ID: "sandbox-repl",
  APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
};

test("legacy import is disabled unless its flag is exactly true", () => {
  for (const value of [undefined, "false", "TRUE", " true", "true "]) {
    const env = { ...sandboxEnv, [LEGACY_CUSTOMER_IMPORT_FLAG]: value };
    const gate = evaluateLegacyCustomerImportGate(env);
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /must be exactly "true"/);
  }
});

test("legacy import requires an authorized Sandbox", () => {
  const gate = evaluateLegacyCustomerImportGate({
    ...sandboxEnv,
    APP_MIGRATION_ENVIRONMENT: "production",
  });
  assert.equal(gate.enabled, true);
  assert.equal(gate.authorizedSandbox, false);
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /authorized Sandbox required/);
});

test("production configuration cannot enable legacy import", () => {
  const gate = evaluateLegacyCustomerImportGate({
    ...sandboxEnv,
    APP_MIGRATION_ENVIRONMENT: "production",
    REPL_ID: "production-repl",
  });
  assert.equal(gate.allowed, false);
});

test("legacy import requires a deliberate invocation", async () => {
  let writes = 0;
  const importer = async () => {
    writes++;
    return { customersCreated: 1, jobsCreated: 0, skipped: 0 };
  };

  await assert.rejects(
    invokeLegacyCustomerImport({
      invocation: "startup",
      env: sandboxEnv,
      importer,
    }),
    /requires invocation "manual-cli"/,
  );
  assert.equal(writes, 0);
});

test("authorized manual invocation is the only path that calls the importer", async () => {
  let writes = 0;
  const importer = async () => {
    writes++;
    return { customersCreated: 1, jobsCreated: 2, skipped: 0 };
  };

  const result = await invokeLegacyCustomerImport({
    invocation: LEGACY_CUSTOMER_IMPORT_INVOCATION,
    env: sandboxEnv,
    importer,
  });

  assert.deepEqual(result, { customersCreated: 1, jobsCreated: 2, skipped: 0 });
  assert.equal(writes, 1);
});

test("default startup source contains no legacy import or demo seed invocation", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /importCFDataFromFiles|seedDemoData|autoSeedIfEmpty/);
  assert.doesNotMatch(source, /COUNT\(\*\)::int AS cnt FROM customers/);
});