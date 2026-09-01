import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { activityLogsTable, communicationEventsTable, jobsTable } from "@workspace/db";
import { authorizeApiRequest } from "../lib/authorization.ts";
import { hasActiveJobAssignment, type ActiveAssignmentGraph } from "../lib/field-tech-scope.ts";
import { createJobsRouter, serializeJob } from "./jobs.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

type Job = {
  id: number; customerId: number; jobNumber: string; status: string;
  assignedTechnicianUserId: string | null; crewId: number | null;
  scheduledDate: string | null; lineItems: string; createdAt: Date; updatedAt: Date;
};

class NormalizedAssignmentRepository {
  readonly users = new Map<string, { isActive: boolean }>([
    ["tech-a", { isActive: true }], ["tech-b", { isActive: true }],
  ]);
  readonly crews = new Map<number, { isActive: boolean }>([[10, { isActive: true }]]);
  memberships: Array<{ crewId: number; userId: string; role: string }> = [];
  readonly jobs: Job[] = [
    // Legacy snapshots intentionally name tech-a, but have no canonical assignment.
    { id: 1, customerId: 1, jobNumber: "LEGACY", status: "scheduled", assignedTechnicianUserId: null, crewId: null, scheduledDate: "2026-08-14", lineItems: JSON.stringify([{ assignedUserIds: ["tech-a"] }]), createdAt: NOW, updatedAt: NOW },
    { id: 2, customerId: 1, jobNumber: "DIRECT", status: "scheduled", assignedTechnicianUserId: "tech-a", crewId: null, scheduledDate: "2026-08-14", lineItems: "[]", createdAt: NOW, updatedAt: NOW },
    { id: 3, customerId: 1, jobNumber: "CREW", status: "scheduled", assignedTechnicianUserId: null, crewId: 10, scheduledDate: "2026-08-14", lineItems: "[]", createdAt: NOW, updatedAt: NOW },
  ];
  writes = 0;

  graph(): ActiveAssignmentGraph {
    return { users: this.users, crews: this.crews, memberships: this.memberships };
  }
  assigned(job: Job, userId: string) { return hasActiveJobAssignment(job, userId, this.graph()); }
  listAssigned = async (userId: string) => {
    const rows = this.jobs.filter((job) => this.assigned(job, userId));
    return { rows: rows as any[], total: rows.length };
  };
  listUnscheduled = async (userId: string) => this.jobs.filter((job) => !job.scheduledDate && this.assigned(job, userId)) as any[];
  enrichAssigned = async (jobs: any[]) => jobs;
  find = async (id: number) => this.jobs.find((job) => job.id === id) as any ?? null;
  findAssigned = async (id: number, userId: string) =>
    this.jobs.find((job) => job.id === id && this.assigned(job, userId)) as any ?? null;
  getAssignedDetails = this.findAssigned;
  getDetails = this.find;
}

function lockedMutationDatabase(
  assignedAfterLock: boolean,
  scheduledDate = "2026-08-14",
  currentStatus = "scheduled",
) {
  const current = {
    status: currentStatus, customerId: 1, jobNumber: "DIRECT", propertyId: null,
    scheduledDate, crewId: null, notes: null, techNotes: null, lineItems: "[]",
    assignedTechnicianUserId: "tech-a",
  };
  const lockedChain: any = {
    from: () => lockedChain, where: () => lockedChain, for: async () => [current],
  };
  const assignmentChain: any = {
    from: () => assignmentChain, where: () => assignmentChain,
    then: (resolve: any, reject: any) => Promise.resolve(
      assignedAfterLock ? [{ id: 2 }] : [],
    ).then(resolve, reject),
  };
  return {
    writes: 0,
    transaction: async (run: (tx: any) => Promise<any>) => run({
      // The real transaction has separate locked-row and assignment-recheck
      // builders. Model those boundaries directly instead of sharing a
      // thenable fluent object.
      select: (shape: Record<string, unknown>) => "status" in shape ? lockedChain : assignmentChain,
      update: () => { throw new Error("job write must not be reached"); },
      insert: () => { throw new Error("activity write must not be reached"); },
    }),
  };
}

class JobCreationMutationDatabase {
  readonly committedJobs: any[] = [];
  transactionCalls = 0;
  jobWriteAttempts = 0;
  activityWriteAttempts = 0;
  eventWriteAttempts = 0;
  private readonly failActivity: boolean;

  constructor(failActivity = false) {
    this.failActivity = failActivity;
  }

  transaction = async (run: (tx: any) => Promise<any>) => {
    this.transactionCalls += 1;
    const pendingJobs: any[] = [];
    const tx = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          if (table === jobsTable) {
            this.jobWriteAttempts += 1;
            const job = {
              ...values,
              id: 100,
              assignedTechnicianUserId: values.assignedTechnicianUserId ?? null,
              updatedAt: NOW,
              createdAt: NOW,
            };
            return { returning: async () => {
              pendingJobs.push(job);
              return [job];
            } };
          }
          if (table === activityLogsTable) {
            this.activityWriteAttempts += 1;
            return this.failActivity
              ? Promise.reject(new Error("forced activity insert failure"))
              : Promise.resolve();
          }
          if (table === communicationEventsTable) {
            this.eventWriteAttempts += 1;
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: 500, ...values }],
              }),
            };
          }
          throw new Error("unexpected insert table");
        },
      }),
    };
    const result = await run(tx);
    this.committedJobs.push(...pendingJobs);
    return result;
  };
}

class JobUpdateMutationDatabase {
  job: any = {
    id: 100,
    customerId: 1,
    propertyId: null,
    quoteId: null,
    crewId: null,
    assignedTechnicianUserId: null,
    recurringPlanId: null,
    jobNumber: "J-DATE-BOUNDARY",
    status: "scheduled",
    serviceType: null,
    scheduledDate: "2026-08-29",
    scheduledStartTime: null,
    scheduledEndTime: null,
    estimatedDuration: null,
    isRecurring: false,
    recurringFrequency: null,
    totalAmount: "0",
    notes: "DISPOSABLE QA FUTURE DATE TEST",
    techNotes: null,
    lineItems: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  transaction = async (run: (tx: any) => Promise<any>) => {
    const lockedChain: any = {
      from: () => lockedChain,
      where: () => lockedChain,
      for: async () => [this.job],
    };
    const tx = {
      select: () => lockedChain,
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              this.job = { ...this.job, ...values, updatedAt: NOW };
              return [this.job];
            },
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          if (table === activityLogsTable) return Promise.resolve();
          if (table === communicationEventsTable) {
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: 501, ...values }],
              }),
            };
          }
          throw new Error("unexpected insert table");
        },
      }),
    };
    return run(tx);
  };
}

async function withHttp(
  run: (base: string, repository: NormalizedAssignmentRepository) => Promise<void>,
  mutationDatabase?: Pick<any, "transaction">,
) {
  const repository = new NormalizedAssignmentRepository();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = {
      id: req.header("x-user") ?? "tech-a",
      role: req.header("x-role") ?? "field_tech",
      firstName: "Test",
      lastName: "Actor",
    };
    next();
  });
  app.use(authorizeApiRequest);
  app.use(createJobsRouter(repository, mutationDatabase));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, repository); }
  finally { await close(server); }
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function call(base: string, path: string, method = "GET", body?: unknown, user = "tech-a", role = "field_tech") {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-user": user, "x-role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("normalized assignment repository ignores legacy crew and line-item snapshots on list, search, and detail", async () => {
  await withHttp(async (base, repository) => {
    // Both old crew fields and old line-item assignedUserIds are presentation-only.
    (repository.jobs[0] as any).legacyCrew = { leadTechnician: "tech-a", members: "tech-a" };
    assert.deepEqual((await call(base, "/jobs")).body.map((job: Job) => job.id), [2]);
    assert.deepEqual((await call(base, "/jobs?status=scheduled")).body.map((job: Job) => job.id), [2]);
    assert.equal((await call(base, "/jobs/1")).status, 404);
    assert.equal((await call(base, "/jobs/2")).status, 200);
    assert.equal(repository.writes, 0);
  });
});

test("active direct, member, and lead assignments grant access; every normalized revocation hides work", async () => {
  await withHttp(async (base, repository) => {
    repository.memberships = [{ crewId: 10, userId: "tech-a", role: "member" }];
    assert.deepEqual((await call(base, "/jobs")).body.map((job: Job) => job.id), [2, 3]);
    repository.memberships = [{ crewId: 10, userId: "tech-a", role: "lead" }];
    assert.equal((await call(base, "/jobs/3")).status, 200);

    repository.memberships = []; // removed membership
    assert.equal((await call(base, "/jobs/3")).status, 404);
    repository.memberships = [{ crewId: 10, userId: "tech-a", role: "member" }];
    repository.crews.set(10, { isActive: false }); // inactive crew
    assert.equal((await call(base, "/jobs/3")).status, 404);
    repository.crews.set(10, { isActive: true });
    repository.users.set("tech-a", { isActive: false }); // inactive user revokes direct and crew access
    assert.deepEqual((await call(base, "/jobs")).body, []);
    repository.users.set("tech-a", { isActive: true });
    repository.jobs[1].assignedTechnicianUserId = "tech-b"; // direct reassignment
    assert.equal((await call(base, "/jobs/2")).status, 404);
    assert.equal(repository.writes, 0);
  });
});

test("field tech assignment changes and a revoked preflight produce 403 with zero repository writes", async () => {
  await withHttp(async (base, repository) => {
    for (const body of [{ assignedTechnicianUserId: "tech-b" }, { crewId: 10 }]) {
      assert.equal((await call(base, "/jobs/2", "PATCH", body)).status, 403);
    }
    repository.jobs[1].assignedTechnicianUserId = "tech-b";
    const revoked = await call(base, "/jobs/2", "PATCH", { status: "in_progress" });
    assert.equal(revoked.status, 403);
    assert.deepEqual(revoked.body, { error: "This job is not assigned to you", code: "assigned_work_required" });
    assert.equal(repository.writes, 0);
  });
});

test("locked assignment recheck denies a revocation after preflight without job or activity writes", async () => {
  const mutation = lockedMutationDatabase(false);
  await withHttp(async (base, repository) => {
    const response = await call(base, "/jobs/2", "PATCH", { status: "in_progress" });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: "This job is not assigned to you", code: "assigned_work_required" });
    assert.equal(repository.writes, 0);
    assert.equal(mutation.writes, 0);
  }, mutation);
});

test("future start and completion are stable 400 future_scheduled_job responses with zero writes", async () => {
  for (const status of ["in_progress", "completed"]) {
    const mutation = lockedMutationDatabase(
      true,
      "9999-12-31",
      status === "completed" ? "in_progress" : "scheduled",
    );
    await withHttp(async (base, repository) => {
      const response = await call(base, "/jobs/2", "PATCH", { status });
      assert.equal(response.status, 400, `${status}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.code, "future_scheduled_job");
      assert.equal(response.body.error, "Cannot start or complete a future-dated job");
      assert.equal(response.body.scheduledDate, "9999-12-31");
      assert.equal(repository.writes, 0);
      assert.equal(mutation.writes, 0);
    }, mutation);
  }
});

test("POST /jobs rejects future start and completion before job, activity, or event writes", async () => {
  for (const status of ["in_progress", "completed"]) {
    const mutation = new JobCreationMutationDatabase();
    await withHttp(async (base, repository) => {
      const response = await call(base, "/jobs", "POST", {
        customerId: 1,
        scheduledDate: "9999-12-31",
        status,
      }, "office-a", "office_admin");
      assert.equal(response.status, 400, `${status}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.code, "future_scheduled_job");
      assert.equal(response.body.error, "Cannot start or complete a future-dated job");
      assert.equal(response.body.scheduledDate, "9999-12-31");
      assert.equal(mutation.transactionCalls, 0);
      assert.equal(mutation.jobWriteAttempts, 0);
      assert.equal(mutation.activityWriteAttempts, 0);
      assert.equal(mutation.eventWriteAttempts, 0);
      assert.equal(mutation.committedJobs.length, 0);
      assert.equal(repository.writes, 0);
    }, mutation);
  }
});

test("POST /jobs rolls back the job and returns 500 when job_created activity insertion fails", async () => {
  const mutation = new JobCreationMutationDatabase(true);
  await withHttp(async (base, repository) => {
    const response = await call(base, "/jobs", "POST", {
      customerId: 1,
      scheduledDate: "2026-08-14",
      status: "scheduled",
    }, "office-a", "office_admin");
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: "Failed to create job" });
    assert.equal(mutation.transactionCalls, 1);
    assert.equal(mutation.jobWriteAttempts, 1);
    assert.equal(mutation.activityWriteAttempts, 1);
    assert.equal(mutation.eventWriteAttempts, 0);
    assert.equal(mutation.committedJobs.length, 0);
    assert.equal(repository.writes, 0);
  }, mutation);
});

test("POST response and GET preserve a Chicago-boundary YYYY-MM-DD exactly", async () => {
  const mutation = new JobCreationMutationDatabase();
  await withHttp(async (base, repository) => {
    repository.getDetails = async (id: number) => {
      const job = mutation.committedJobs.find((candidate) => candidate.id === id);
      return job ? serializeJob(job) : null;
    };

    const created = await call(base, "/jobs", "POST", {
      customerId: 1,
      scheduledDate: "2026-08-30",
      notes: "DISPOSABLE QA FUTURE DATE TEST",
      status: "scheduled",
    }, "owner-a", "admin");

    assert.equal(created.status, 201);
    assert.equal(mutation.committedJobs[0]?.scheduledDate, "2026-08-30");
    assert.equal(created.body.scheduledDate, "2026-08-30");
    assert.equal(created.body.notes, "DISPOSABLE QA FUTURE DATE TEST");

    const reloaded = await call(base, "/jobs/100", "GET", undefined, "owner-a", "admin");
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.scheduledDate, "2026-08-30");
    assert.equal(reloaded.body.notes, "DISPOSABLE QA FUTURE DATE TEST");
  }, mutation);
});

test("PATCH response and subsequent GET preserve the committed date exactly", async () => {
  const mutation = new JobUpdateMutationDatabase();
  await withHttp(async (base, repository) => {
    repository.getDetails = async (id: number) =>
      id === mutation.job.id ? serializeJob(mutation.job) : null;

    const patched = await call(base, "/jobs/100", "PATCH", {
      scheduledDate: "2026-08-30",
      notes: "DISPOSABLE QA FUTURE DATE TEST",
    }, "owner-a", "admin");

    assert.equal(patched.status, 200);
    assert.equal(mutation.job.scheduledDate, "2026-08-30");
    assert.equal(patched.body.scheduledDate, "2026-08-30");
    assert.equal(patched.body.notes, "DISPOSABLE QA FUTURE DATE TEST");

    const reloaded = await call(base, "/jobs/100", "GET", undefined, "owner-a", "admin");
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.scheduledDate, "2026-08-30");
    assert.equal(reloaded.body.notes, "DISPOSABLE QA FUTURE DATE TEST");
  }, mutation);
});