import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMigrationGate,
  MigrationIdentityError,
  MigrationGateError,
  runRequiredMigrationsAtStartup,
  runMigration,
  type MigrationClient,
  type MigrationDefinition,
  type MigrationEnvironment,
} from "./application-migrations.ts";
import { assertBackupCoverage } from "./account-lifecycle-v1.ts";

class FakeClient implements MigrationClient {
  calls: Array<{ text: string; values: readonly unknown[] }> = [];
  existing: Record<string, unknown> | null = null;
  released = false;

  async query(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values });
    if (text.includes("FROM application_migrations")) {
      return { rows: this.existing ? [this.existing] : [] };
    }
    if (text.startsWith("INSERT INTO application_migrations")) {
      this.existing = {
        migration_id: values[0],
        checksum: values[1],
        environment: values[2],
        state: "running",
      };
    }
    if (text.startsWith("UPDATE application_migrations")) {
      if (this.existing) {
        if (text.includes("state = 'applied'")) this.existing.state = "applied";
        if (text.includes("state = 'failed'")) this.existing.state = "failed";
      }
    }
    return { rows: [], rowCount: 1 };
  }

  release() {
    this.released = true;
  }
}

function eligibleGate() {
  return evaluateMigrationGate({
    APP_MIGRATIONS_ENABLED: "true",
    APP_MIGRATION_ENVIRONMENT: "sandbox",
    REPL_ID: "sandbox-repl",
    APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
  });
}

function fakeMigration(
  overrides: Partial<MigrationDefinition> = {},
): MigrationDefinition {
  return {
    id: "test-migration",
    checksum: "checksum-v1",
    description: "redacted test migration",
    required: true,
    preflight: async () => ({ ok: true }),
    backup: async () => ({ backupRows: 1 }),
    apply: async () => ({ updatedRows: 1 }),
    postflight: async () => ({ verified: true }),
    verify: async () => ({ verified: true }),
    rollback: async () => ({ restoredRows: 1 }),
    ...overrides,
  };
}

function poolFor(client: FakeClient) {
  return { connect: async () => client };
}

test("migration gate allows only explicitly identified Sandbox", () => {
  assert.equal(eligibleGate().eligible, true);
  assert.equal(
    evaluateMigrationGate({
      NODE_ENV: "production",
    }).eligible,
    false,
  );
  assert.equal(
    evaluateMigrationGate({
      APP_MIGRATIONS_ENABLED: "true",
      APP_MIGRATION_ENVIRONMENT: "sandbox",
      REPL_ID: "sandbox-repl",
    }).reason,
    "Sandbox Repl identity is incomplete",
  );
  assert.equal(
    evaluateMigrationGate({
      APP_MIGRATIONS_ENABLED: "true",
      APP_MIGRATION_ENVIRONMENT: "production",
      REPL_ID: "production-repl",
      APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
    }).eligible,
    false,
  );
});

test("published Sandbox domain attestation covers missing deployment Repl identity", () => {
  const gate = evaluateMigrationGate({
    APP_MIGRATIONS_ENABLED: "true",
    APP_MIGRATION_ENVIRONMENT: "sandbox",
    APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
    APP_MIGRATION_SANDBOX_DOMAIN: "sandbox-win-crm.replit.app",
    REPLIT_DOMAINS: "sandbox-win-crm.replit.app",
  });
  assert.equal(gate.eligible, true);
  assert.equal(gate.reason, "eligible Sandbox deployment domain");

  assert.equal(
    evaluateMigrationGate({
      APP_MIGRATIONS_ENABLED: "true",
      APP_MIGRATION_ENVIRONMENT: "sandbox",
      APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
      APP_MIGRATION_SANDBOX_DOMAIN: "sandbox-win-crm.replit.app",
      REPLIT_DOMAINS: "other-repl.replit.app",
    }).eligible,
    false,
  );
});

test("eligible startup is fail-closed when the gate is invalid", async () => {
  await assert.rejects(
    runRequiredMigrationsAtStartup(
      { connect: async () => new FakeClient() },
      evaluateMigrationGate({
        APP_MIGRATIONS_ENABLED: "true",
        APP_MIGRATION_ENVIRONMENT: "production",
        REPL_ID: "production-repl",
        APP_MIGRATION_SANDBOX_REPL_ID: "sandbox-repl",
      }),
    ),
    MigrationGateError,
  );
});

test("migration checksum drift is rejected before application", async () => {
  const client = new FakeClient();
  client.existing = {
    migration_id: "test-migration",
    checksum: "checksum-old",
    environment: "sandbox",
    state: "applied",
  };

  await assert.rejects(
    runMigration(fakeMigration(), {
      pool: poolFor(client),
      environment: "sandbox" as MigrationEnvironment,
      gate: eligibleGate(),
    }),
    MigrationIdentityError,
  );
  assert.equal(client.calls.some((call) => call.text.includes("UPDATE customers")), false);
  assert.equal(client.released, true);
});

test("already applied migration is idempotent under the advisory lock", async () => {
  const client = new FakeClient();
  client.existing = {
    migration_id: "test-migration",
    checksum: "checksum-v1",
    environment: "sandbox",
    state: "applied",
  };

  const result = await runMigration(fakeMigration(), {
    pool: poolFor(client),
    environment: "sandbox",
    gate: eligibleGate(),
  });
  assert.deepEqual(result, {
    migrationId: "test-migration",
    state: "applied",
    skipped: true,
  });
  assert.equal(
    client.calls.some((call) =>
      call.text.includes("pg_advisory_xact_lock"),
    ),
    true,
  );
  assert.equal(client.calls.filter((call) => call.text === "COMMIT").length, 1);
});

test("preflight failure rolls back and records a redacted failure state", async () => {
  const client = new FakeClient();
  const migration = fakeMigration({
    preflight: async () => {
      throw new Error("customer@example.com must not be persisted");
    },
  });

  await assert.rejects(
    runMigration(migration, {
      pool: poolFor(client),
      environment: "sandbox",
      gate: eligibleGate(),
    }),
  );
  assert.equal(client.existing?.state, "failed");
  assert.equal(client.calls.filter((call) => call.text === "ROLLBACK").length, 1);
  assert.equal(
    client.calls.some((call) => call.values.includes("preflight_failed")),
    true,
  );
  assert.equal(
    client.calls.some((call) => call.values.includes("customer@example.com")),
    false,
  );
});

test("apply failure rolls back the whole transaction", async () => {
  const client = new FakeClient();
  const migration = fakeMigration({
    apply: async () => {
      throw new Error("apply failed");
    },
  });

  await assert.rejects(
    runMigration(migration, {
      pool: poolFor(client),
      environment: "sandbox",
      gate: eligibleGate(),
    }),
  );
  assert.equal(client.existing?.state, "failed");
  assert.equal(
    client.calls.some((call) => call.values.includes("apply_failed")),
    true,
  );
});

test("backup summary is committed only after postflight succeeds", async () => {
  const client = new FakeClient();
  const result = await runMigration(fakeMigration(), {
    pool: poolFor(client),
    environment: "sandbox",
    gate: eligibleGate(),
  });
  assert.equal(result.skipped, false);
  assert.deepEqual(result.summary?.backup, { backupRows: 1 });
  assert.equal(client.existing?.state, "applied");
});

test("backup coverage rejects missing or duplicate backup keys", () => {
  assert.doesNotThrow(() => assertBackupCoverage(3, 3, 3));
  assert.throws(() => assertBackupCoverage(3, 2, 3), /backup verification/);
  assert.throws(() => assertBackupCoverage(3, 3, 2), /backup verification/);
});

test("postflight failure rolls back instead of marking applied", async () => {
  const client = new FakeClient();
  const migration = fakeMigration({
    postflight: async () => {
      throw new Error("postflight failed");
    },
  });

  await assert.rejects(
    runMigration(migration, {
      pool: poolFor(client),
      environment: "sandbox",
      gate: eligibleGate(),
    }),
  );
  assert.equal(client.existing?.state, "failed");
  assert.equal(
    client.calls.some((call) => call.values.includes("postflight_failed")),
    true,
  );
});