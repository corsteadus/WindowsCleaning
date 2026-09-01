import assert from "node:assert/strict";
import test from "node:test";
import {
  SANDBOX_PURGE_CONFIRMATION,
  evaluateSandboxPurgeGate,
  purgeSandboxCrmData,
  runSandboxPurge,
  sandboxPurgeDeleteOrder,
} from "./admin-purge.ts";

const sandboxEnv = {
  APP_PURGE_ENABLED: "true",
  APP_MIGRATION_ENVIRONMENT: "sandbox",
  APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-2",
  REPL_ID: "sandbox-2",
};

test("purge gate is fail-closed and requires exact confirmation", () => {
  for (const env of [
    {},
    { ...sandboxEnv, APP_PURGE_ENABLED: "false" },
    { ...sandboxEnv, APP_MIGRATION_ENVIRONMENT: "production" },
    { ...sandboxEnv, REPL_ID: "different-repl" },
  ]) {
    assert.equal(
      evaluateSandboxPurgeGate(env, SANDBOX_PURGE_CONFIRMATION).allowed,
      false,
    );
  }
  assert.equal(evaluateSandboxPurgeGate(sandboxEnv, "purge").allowed, false);
  assert.equal(
    evaluateSandboxPurgeGate(sandboxEnv, SANDBOX_PURGE_CONFIRMATION).allowed,
    true,
  );
});

test("a denied purge opens no transaction and issues no writes", async () => {
  let transactions = 0;
  let writes = 0;
  const gate = await runSandboxPurge({
    transaction: async () => {
      transactions++;
      throw new Error("denied purge must not start a transaction");
    },
    execute: async () => {
      writes++;
    },
  }, sandboxEnv, "not-the-exact-confirmation");
  assert.equal(gate.allowed, false);
  assert.equal(transactions, 0);
  assert.equal(writes, 0);
});

test("identity failures deny before transaction even when the configured domain matches", async () => {
  const deniedEnvironments = [
    {
      ...sandboxEnv,
      REPL_ID: "other-repl",
      APP_MIGRATION_SANDBOX_DOMAIN: "sandbox.example",
      REPLIT_DOMAINS: "sandbox.example",
    },
    {
      ...sandboxEnv,
      REPL_ID: "",
      APP_MIGRATION_SANDBOX_DOMAIN: "sandbox.example",
      REPLIT_DOMAINS: "sandbox.example",
    },
    { ...sandboxEnv, APP_MIGRATION_SANDBOX_REPL_ID: "" },
  ];

  for (const env of deniedEnvironments) {
    let transactions = 0;
    let writes = 0;
    const gate = await runSandboxPurge({
      transaction: async () => {
        transactions++;
        throw new Error("identity failure must not start a transaction");
      },
      execute: async () => {
        writes++;
      },
    }, env, SANDBOX_PURGE_CONFIRMATION);
    assert.equal(gate.allowed, false);
    assert.equal(transactions, 0);
    assert.equal(writes, 0);
  }
});

test("purge performs all writes in one transaction and deletes membership before crews", async () => {
  const writes: string[] = [];
  let transactions = 0;
  await purgeSandboxCrmData({
    transaction: async (work) => {
      transactions++;
      return work({
        execute: async (statement) => {
          writes.push(String(statement));
        },
      });
    },
    execute: async () => assert.fail("writes must use the transaction"),
  });
  assert.equal(transactions, 1);
  assert.ok(sandboxPurgeDeleteOrder.indexOf("crew_members")
    < sandboxPurgeDeleteOrder.indexOf("crews"));
  assert.equal(writes.length, sandboxPurgeDeleteOrder.length + 14);
});

test("purge lets a transaction rollback all writes on failure", async () => {
  let committed = false;
  const persisted: string[] = [];
  await assert.rejects(() => purgeSandboxCrmData({
    transaction: async (work) => {
      const staged: string[] = [];
      try {
        await work({
          execute: async (statement) => {
            staged.push(String(statement));
            if (staged.length === 2) throw new Error("injected failure");
          },
        });
        persisted.push(...staged);
        committed = true;
      } catch (error) {
        throw error;
      }
    },
    execute: async () => assert.fail("writes must use the transaction"),
  }));
  assert.equal(committed, false);
  assert.deepEqual(persisted, []);
});