import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_SEED_CONFIRMATION,
  evaluateDemoSeedGate,
  seedDemoData,
} from "./seed-demo.ts";

const sandboxEnv = {
  APP_MIGRATION_ENVIRONMENT: "sandbox",
  REPL_ID: "sandbox-repl",
  APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
};

test("demo seed requires the exact deliberate confirmation", () => {
  for (const confirmation of [undefined, "", "seed_demo_data", "SEED_DEMO"]) {
    const gate = evaluateDemoSeedGate(sandboxEnv, confirmation);
    assert.equal(gate.allowed, false);
    assert.equal(gate.authorizedSandbox, true);
    assert.match(gate.reason, /confirmation must exactly match/);
  }

  const gate = evaluateDemoSeedGate(sandboxEnv, DEMO_SEED_CONFIRMATION);
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, "authorized Sandbox demo seed");
});

test("demo seed requires an authorized Sandbox even with confirmation", () => {
  const productionGate = evaluateDemoSeedGate(
    {
      ...sandboxEnv,
      APP_MIGRATION_ENVIRONMENT: "production",
      REPL_ID: "production-repl",
    },
    DEMO_SEED_CONFIRMATION,
  );
  assert.equal(productionGate.authorizedSandbox, false);
  assert.equal(productionGate.allowed, false);
  assert.match(productionGate.reason, /authorized Sandbox required/);

  const normalProductionGate = evaluateDemoSeedGate(
    { NODE_ENV: "production" },
    DEMO_SEED_CONFIRMATION,
  );
  assert.equal(normalProductionGate.allowed, false);
});

test("normal production configuration performs zero seed writes", async () => {
  let writes = 0;
  const result = await seedDemoData({
    confirmation: DEMO_SEED_CONFIRMATION,
    env: { NODE_ENV: "production" },
    execute: async () => {
      writes++;
      return { success: true, message: "unexpected write" };
    },
  });

  assert.equal(result.success, false);
  assert.match(result.message, /Demo seed denied/);
  assert.equal(writes, 0);
});

test("authorized Sandbox remains available for intentional demo setup", async () => {
  let writes = 0;
  const gate = evaluateDemoSeedGate(
    { ...sandboxEnv, APP_MIGRATIONS_ENABLED: "false" },
    DEMO_SEED_CONFIRMATION,
  );
  assert.equal(gate.allowed, true);

  const result = await seedDemoData({
    confirmation: DEMO_SEED_CONFIRMATION,
    env: { ...sandboxEnv, APP_MIGRATIONS_ENABLED: "false" },
    execute: async () => {
      writes++;
      return { success: true, message: "demo setup complete" };
    },
  });
  assert.deepEqual(result, { success: true, message: "demo setup complete" });
  assert.equal(writes, 1);
});