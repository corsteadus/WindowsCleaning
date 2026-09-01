import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { createTasksRouter, type TasksRepository } from "./tasks.ts";

const CREATED_AT = "2026-08-14T12:00:00.000Z";

type TaskRow = {
  id: number;
  relatedType: string | null;
  relatedId: number | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
};

class TasksFixture implements TasksRepository {
  writes = 0;
  nextId = 2;
  rows: TaskRow[] = [{
    id: 1,
    relatedType: null,
    relatedId: null,
    title: "Existing task",
    description: null,
    status: "pending",
    priority: "normal",
    dueAt: null,
    completedAt: null,
    assignedTo: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }];

  async list(filters: { relatedType?: string; relatedId?: number; status?: string }) {
    return this.rows.filter((row) =>
      (filters.relatedType === undefined || row.relatedType === filters.relatedType)
      && (filters.relatedId === undefined || row.relatedId === filters.relatedId)
      && (filters.status === undefined || row.status === filters.status)
    ).map((row) => ({ ...row }));
  }

  async create(values: Record<string, unknown>) {
    this.writes += 1;
    const row = {
      id: this.nextId++,
      ...values,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    } as TaskRow;
    this.rows.push(row);
    return { ...row };
  }

  async update(id: number, values: Record<string, unknown>) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) return null;
    this.writes += 1;
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = value;
    }
    row.updatedAt = CREATED_AT;
    return { ...row };
  }

  async remove(id: number) {
    this.writes += 1;
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function withHttp(run: (base: string, fixture: TasksFixture) => Promise<void>) {
  const fixture = new TasksFixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = {
      id: "contract-user",
      role: req.header("x-role") ?? "office_admin",
    };
    next();
  });
  app.use(createTasksRouter(fixture));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`, fixture);
  } finally {
    await close(server);
  }
}

async function call(
  base: string,
  path: string,
  method = "GET",
  body?: unknown,
  role = "office_admin",
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

test("Office Admin exercises the production tasks router CRUD contract over HTTP", async () => {
  await withHttp(async (base, fixture) => {
    const initial = await call(base, "/tasks");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.map((row: TaskRow) => row.id), [1]);

    const created = await call(base, "/tasks", "POST", { title: "Call customer" });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, "Call customer");
    assert.equal(created.body.status, "pending");

    const patched = await call(base, `/tasks/${created.body.id}`, "PATCH", {
      title: "Call customer tomorrow",
      priority: "high",
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.title, "Call customer tomorrow");
    assert.equal(patched.body.priority, "high");

    const removed = await call(base, `/tasks/${created.body.id}`, "DELETE");
    assert.equal(removed.status, 204);
    assert.deepEqual((await call(base, "/tasks")).body.map((row: TaskRow) => row.id), [1]);
    assert.equal(fixture.writes, 3);
  });
});

test("field_tech and legacy team_tech are denied every tasks method before writes", async () => {
  for (const role of ["field_tech", "team_tech"]) {
    await withHttp(async (base, fixture) => {
      const attempts = [
        await call(base, "/tasks", "GET", undefined, role),
        await call(base, "/tasks", "POST", { title: "Forbidden" }, role),
        await call(base, "/tasks/1", "PATCH", { title: "Forbidden" }, role),
        await call(base, "/tasks/1", "DELETE", undefined, role),
      ];
      assert.deepEqual(attempts.map(({ status }) => status), [403, 403, 403, 403]);
      assert.deepEqual(
        attempts.map(({ body }) => body.capability),
        ["tasks.view", "tasks.manage", "tasks.manage", "tasks.manage"],
      );
      assert.equal(fixture.writes, 0);
      assert.equal(fixture.rows[0].title, "Existing task");
    });
  }
});

test("dueAt POST, PATCH, offset conversion, and null clearing round-trip over HTTP", async () => {
  await withHttp(async (base) => {
    const created = await call(base, "/tasks", "POST", {
      title: "Offset task",
      dueAt: "2026-09-03T09:15:30-05:00",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.dueAt, "2026-09-03T14:15:30.000Z");

    let listed = await call(base, "/tasks");
    let row = listed.body.find((candidate: TaskRow) => candidate.id === created.body.id);
    assert.equal(row.dueAt, "2026-09-03T14:15:30.000Z");

    const patched = await call(base, `/tasks/${created.body.id}`, "PATCH", {
      dueAt: "2026-12-01T18:45:00+02:30",
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.dueAt, "2026-12-01T16:15:00.000Z");

    listed = await call(base, "/tasks");
    row = listed.body.find((candidate: TaskRow) => candidate.id === created.body.id);
    assert.equal(row.dueAt, "2026-12-01T16:15:00.000Z");

    const cleared = await call(base, `/tasks/${created.body.id}`, "PATCH", { dueAt: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.dueAt, null);
    listed = await call(base, "/tasks");
    row = listed.body.find((candidate: TaskRow) => candidate.id === created.body.id);
    assert.equal(row.dueAt, null);
  });
});

test("invalid dueAt forms are rejected before repository writes", async () => {
  const invalidValues = [
    "2026-09-03T09:15:30",
    "2026-09-03",
    "not-a-date",
  ];
  for (const dueAt of invalidValues) {
    await withHttp(async (base, fixture) => {
      const post = await call(base, "/tasks", "POST", { title: "Invalid", dueAt });
      assert.equal(post.status, 400);
      assert.equal(fixture.writes, 0);

      const patch = await call(base, "/tasks/1", "PATCH", { dueAt });
      assert.equal(patch.status, 400);
      assert.equal(fixture.writes, 0);
      assert.equal(fixture.rows[0].dueAt, null);
    });
  }
});