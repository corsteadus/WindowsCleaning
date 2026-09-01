import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import {
  activityLogsTable,
  invoiceJobsTable,
  invoicesTable,
  jobsTable,
} from "@workspace/db";
import { authorizeApiRequest } from "../lib/authorization.ts";
import {
  createJobsRouter,
  isJobPermanentDeleteProtected,
  serializeJob,
} from "./jobs.ts";

const NOW = new Date("2026-01-15T12:00:00.000Z");

function job(id: number, status = "scheduled") {
  return {
    id,
    customerId: 1,
    propertyId: null,
    quoteId: null,
    crewId: null,
    assignedTechnicianUserId: null,
    recurringPlanId: null,
    jobNumber: `J-${id}`,
    status,
    completedAt: status === "completed" ? NOW.toISOString() : null,
    serviceType: null,
    scheduledDate: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    estimatedDuration: null,
    isRecurring: false,
    recurringFrequency: null,
    totalAmount: "0",
    notes: null,
    techNotes: null,
    lineItems: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class InMemoryJobsDatabase {
  jobs = [job(1)];
  invoices: Array<{ id: number; jobId: number | null }> = [];
  invoiceJobs: Array<{ invoiceId: number; jobId: number }> = [];
  activity: Record<string, unknown>[] = [];
  deleteAttempts = 0;
  transactionCalls = 0;
  failAudit = false;
  nextId = 10;

  repository = {
    listAssigned: async () => ({ rows: [], total: 0 }),
    listUnscheduled: async () => [],
    find: async (id: number) => this.jobs.find((candidate) => candidate.id === id) as any ?? null,
    findAssigned: async () => null,
    getDetails: async (id: number) => {
      const found = this.jobs.find((candidate) => candidate.id === id);
      return found ? serializeJob(found as any) : null;
    },
  };

  transaction = async (run: (tx: any) => Promise<any>) => {
    this.transactionCalls += 1;
    const stagedJobs = this.jobs.map((value) => ({ ...value }));
    const stagedActivity = this.activity.map((value) => ({ ...value }));

    const select = (_shape?: Record<string, unknown>) => {
      let table: unknown;
      const builder: any = {
        from: (value: unknown) => { table = value; return builder; },
        where: () => builder,
        for: async () => table === jobsTable ? stagedJobs.slice(0, 1) : [],
        limit: async () => table === invoicesTable
          ? this.invoices.slice(0, 1)
          : table === invoiceJobsTable ? this.invoiceJobs.slice(0, 1) : [],
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(table === jobsTable ? stagedJobs.slice(0, 1) : []).then(resolve, reject),
      };
      return builder;
    };

    const tx = {
      select,
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          if (table === jobsTable) {
            const created = {
              ...job(this.nextId++),
              ...values,
              createdAt: NOW,
              updatedAt: NOW,
            };
            stagedJobs.push(created as any);
            return { returning: async () => [created] };
          }
          if (table === activityLogsTable) {
            if (this.failAudit) throw new Error("forced transactional audit failure");
            stagedActivity.push(values);
            return Promise.resolve();
          }
          throw new Error("unexpected insert");
        },
      }),
      update: (table: unknown) => {
        assert.equal(table, jobsTable);
        return {
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                const current = stagedJobs[0];
                if (!current) return [];
                Object.assign(current, values, { updatedAt: NOW });
                return [current];
              },
            }),
          }),
        };
      },
      delete: (table: unknown) => {
        assert.equal(table, jobsTable);
        this.deleteAttempts += 1;
        return {
          where: () => ({
            returning: async () => {
              const deleted = stagedJobs.shift();
              return deleted ? [deleted] : [];
            },
          }),
        };
      },
    };

    const result = await run(tx);
    this.jobs = stagedJobs;
    this.activity = stagedActivity;
    return result;
  };
}

async function withHttp(
  state: InMemoryJobsDatabase,
  run: (base: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = {
      id: "office-a",
      role: "office_admin",
      firstName: "Office",
      lastName: "Actor",
    };
    next();
  });
  app.use(authorizeApiRequest);
  app.use(createJobsRouter(
    state.repository as any,
    state,
    (jobId, status) => isJobPermanentDeleteProtected(jobId, status, {
      hasLegacyInvoiceLink: async (id) => state.invoices.some((invoice) => invoice.jobId === id),
      hasInvoiceJobLink: async (id) => state.invoiceJobs.some((association) => association.jobId === id),
    }),
  ));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
}

async function call(base: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test("job detail derives permanent-delete protection from completion and both invoice link models", async () => {
  const state = new InMemoryJobsDatabase();
  await withHttp(state, async (base) => {
    assert.equal((await call(base, "/jobs/1")).body.isDeleteProtected, false);

    state.jobs[0].status = "Completed";
    assert.equal((await call(base, "/jobs/1")).body.isDeleteProtected, true);

    state.jobs[0].status = "scheduled";
    state.invoices = [{ id: 10, jobId: 1 }];
    assert.equal((await call(base, "/jobs/1")).body.isDeleteProtected, true);

    state.invoices = [];
    state.invoiceJobs = [{ invoiceId: 11, jobId: 1 }];
    assert.equal((await call(base, "/jobs/1")).body.isDeleteProtected, true);
  });
});

test("office jobs.manage deletion and its audit commit in one transaction", async () => {
  const state = new InMemoryJobsDatabase();
  await withHttp(state, async (base) => {
    const response = await call(base, "/jobs/1", "DELETE");
    assert.equal(response.status, 204);
    assert.equal(state.transactionCalls, 1);
    assert.equal(state.deleteAttempts, 1);
    assert.equal(state.jobs.length, 0);
    assert.equal(state.activity.length, 1);
    assert.equal(state.activity[0].action, "job_deleted");
    assert.equal(state.activity[0].performedBy, "Office Actor");
  });
});

test("a failed deletion audit rolls back the staged job deletion", async () => {
  const state = new InMemoryJobsDatabase();
  state.failAudit = true;
  await withHttp(state, async (base) => {
    const response = await call(base, "/jobs/1", "DELETE");
    assert.equal(response.status, 500);
    assert.equal(state.deleteAttempts, 1);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.activity.length, 0);
  });
});

test("completed and both forms of invoiced jobs are protected without deletes", async () => {
  for (const setup of ["completed", "legacy", "junction"] as const) {
    const state = new InMemoryJobsDatabase();
    if (setup === "completed") state.jobs[0].status = "completed";
    if (setup === "legacy") state.invoices.push({ id: 20, jobId: 1 });
    if (setup === "junction") state.invoiceJobs.push({ invoiceId: 20, jobId: 1 });
    await withHttp(state, async (base) => {
      const response = await call(base, "/jobs/1", "DELETE");
      assert.equal(response.status, 409, setup);
      assert.equal(state.deleteAttempts, 0, setup);
      assert.equal(state.jobs.length, 1, setup);
      assert.equal(state.invoices.length + state.invoiceJobs.length, setup === "completed" ? 0 : 1);
    });
  }
});

test("a link added after an eligible stale-tab read is rechecked in DELETE transaction", async () => {
  const state = new InMemoryJobsDatabase();
  await withHttp(state, async (base) => {
    assert.equal((await call(base, "/jobs/1")).status, 200);
    state.invoiceJobs.push({ invoiceId: 99, jobId: 1 });
    const response = await call(base, "/jobs/1", "DELETE");
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "invoice_linked_job");
    assert.equal(state.deleteAttempts, 0);
    assert.equal(state.jobs.length, 1);
    assert.equal(state.invoiceJobs.length, 1);
  });
});

test("DELETE rejects malformed and nonpositive ids before opening a transaction", async () => {
  const state = new InMemoryJobsDatabase();
  await withHttp(state, async (base) => {
    for (const id of ["nope", "1x", "0", "-2"]) {
      assert.equal((await call(base, `/jobs/${id}`, "DELETE")).status, 400);
    }
    assert.equal(state.transactionCalls, 0);
    assert.equal(state.deleteAttempts, 0);
  });
});

test("completedAt validates lifecycle and offsets, canonicalizes, derives, and permits unscheduled completion", async () => {
  const state = new InMemoryJobsDatabase();
  state.jobs = [];
  await withHttp(state, async (base) => {
    for (const body of [
      { customerId: 1, status: "scheduled", completedAt: "2025-01-01T12:00:00Z" },
      { customerId: 1, status: "completed", completedAt: null },
      { customerId: 1, status: "completed", completedAt: "2025-01-01T12:00:00" },
    ]) {
      assert.equal((await call(base, "/jobs", "POST", body)).status, 400);
    }

    const explicit = await call(base, "/jobs", "POST", {
      customerId: 1,
      status: "completed",
      completedAt: "2025-01-01T12:30:00-06:00",
    });
    assert.equal(explicit.status, 201);
    assert.equal(explicit.body.completedAt, "2025-01-01T18:30:00.000Z");
    assert.equal(explicit.body.scheduledDate, null);
    const explicitGet = await call(base, `/jobs/${explicit.body.id}`);
    assert.equal(explicitGet.body.completedAt, "2025-01-01T18:30:00.000Z");

    const derived = await call(base, "/jobs", "POST", { customerId: 1, status: "completed" });
    assert.equal(derived.status, 201);
    assert.match(derived.body.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(derived.body.scheduledDate, null);
    assert.equal((await call(base, `/jobs/${derived.body.id}`)).body.completedAt, derived.body.completedAt);
  });
});

test("PATCH completedAt lifecycle persists canonical instants and allows unscheduled completion", async () => {
  for (const body of [
    { completedAt: "2025-01-01T12:00:00Z" },
    { status: "completed", completedAt: null },
    { status: "completed", completedAt: "2025-01-01T12:00:00" },
  ]) {
    const state = new InMemoryJobsDatabase();
    await withHttp(state, async (base) => {
      const response = await call(base, "/jobs/1", "PATCH", body);
      assert.equal(response.status, 400);
      assert.equal(state.jobs[0].status, "scheduled");
      assert.equal(state.jobs[0].completedAt, null);
      assert.equal((await call(base, "/jobs/1")).body.completedAt, null);
    });
  }

  {
    const state = new InMemoryJobsDatabase();
    await withHttp(state, async (base) => {
      const completed = await call(base, "/jobs/1", "PATCH", {
        status: "completed",
        completedAt: "2025-01-01T12:30:00-06:00",
      });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.completedAt, "2025-01-01T18:30:00.000Z");
      const reloaded = await call(base, "/jobs/1");
      assert.equal(reloaded.body.completedAt, "2025-01-01T18:30:00.000Z");
      assert.equal(reloaded.body.scheduledDate, null);
    });
  }

  {
    const state = new InMemoryJobsDatabase();
    await withHttp(state, async (base) => {
      const completed = await call(base, "/jobs/1", "PATCH", { status: "completed" });
      assert.equal(completed.status, 200);
      assert.equal(completed.body.status, "completed");
      assert.match(completed.body.completedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(completed.body.scheduledDate, null);
      const reloaded = await call(base, "/jobs/1");
      assert.equal(reloaded.body.completedAt, completed.body.completedAt);
      assert.equal(reloaded.body.status, "completed");
    });
  }
});

test("scheduled times round-trip through POST, GET, PATCH, GET, clear, and reject malformed values", async () => {
  const state = new InMemoryJobsDatabase();
  state.jobs = [];
  await withHttp(state, async (base) => {
    const created = await call(base, "/jobs", "POST", {
      customerId: 1,
      scheduledStartTime: "08:15",
      scheduledEndTime: "09:45:30",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.scheduledStartTime, "08:15");
    assert.equal(created.body.scheduledEndTime, "09:45:30");
    const id = created.body.id;
    assert.equal((await call(base, `/jobs/${id}`)).body.scheduledStartTime, "08:15");

    const edited = await call(base, `/jobs/${id}`, "PATCH", {
      scheduledStartTime: "10:00:01",
      scheduledEndTime: "11:30",
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.scheduledStartTime, "10:00:01");
    assert.equal((await call(base, `/jobs/${id}`)).body.scheduledEndTime, "11:30");

    const cleared = await call(base, `/jobs/${id}`, "PATCH", {
      scheduledStartTime: null,
      scheduledEndTime: null,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.scheduledStartTime, null);
    assert.equal(cleared.body.scheduledEndTime, null);

    for (const [method, path, body] of [
      ["POST", "/jobs", { customerId: 1, scheduledStartTime: "24:00" }],
      ["PATCH", `/jobs/${id}`, { scheduledEndTime: "9:30" }],
    ] as const) {
      assert.equal((await call(base, path, method, body)).status, 400);
    }
  });
});