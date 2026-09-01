import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { authorizeApiRequest } from "../lib/authorization.ts";

async function withServer(
  handler: (req: express.Request, res: express.Response) => void,
  run: (base: string, counters: { handler: number; transactions: number; writes: number }) => Promise<void>,
) {
  const app = express();
  const counters = { handler: 0, transactions: 0, writes: 0 };
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: "tech-a", role: "field_tech" };
    next();
  });
  app.use(authorizeApiRequest);
  app.patch("/jobs/:id", (req, res) => {
    counters.handler += 1;
    handler(req, res);
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`, counters);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HTTP authorization rejects Field Tech commercial and scheduling writes before handler, transaction, or write", async () => {
  await withServer((_req, res) => res.status(204).end(), async (base, counters) => {
    for (const body of [
      { totalAmount: 99 },
      { scheduledDate: "2026-01-01" },
      { notes: "" },
    ]) {
      const response = await fetch(`${base}/jobs/100`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(counters, { handler: 0, transactions: 0, writes: 0 });
  });
});

test("HTTP authorization permits Field Tech start, complete, and nonblank note operation shapes", async () => {
  await withServer((_req, res) => res.status(204).end(), async (base, counters) => {
    for (const body of [
      { status: "in_progress" },
      { status: "completed" },
      { notes: "Arrived at property" },
      { techNotes: "Completed safely" },
    ]) {
      const response = await fetch(`${base}/jobs/100`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 204);
    }
    assert.equal(counters.handler, 4);
    assert.equal(counters.transactions, 0);
    assert.equal(counters.writes, 0);
  });
});

test("Field Tech note API contract accepts an isolated addition and omits untouched note history", async () => {
  const received: unknown[] = [];
  await withServer((req, res) => {
    received.push(req.body);
    res.status(204).end();
  }, async (base, counters) => {
    const response = await fetch(`${base}/jobs/100`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "One new addition" }),
    });
    assert.equal(response.status, 204);
    assert.deepEqual(received, [{ notes: "One new addition" }]);
    assert.equal(counters.handler, 1);
  });
});

test("unscoped personnel picker is rejected for Field Tech aliases before handler and allowed for office/admin", async () => {
  const app = express();
  let handlerCalls = 0;
  app.use((req, _res, next) => {
    (req as any).user = { id: "user", role: req.header("x-role") ?? "field_tech" };
    next();
  });
  app.use(authorizeApiRequest);
  app.get("/team-users/active", (_req, res) => {
    handlerCalls += 1;
    res.json([{ id: "personnel-record" }]);
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/team-users/active`;
  try {
    for (const role of ["field_tech", "team_tech"]) {
      const response = await fetch(url, { headers: { "x-role": role } });
      assert.equal(response.status, 403);
    }
    assert.equal(handlerCalls, 0);
    for (const role of ["office_admin", "admin"]) {
      const response = await fetch(url, { headers: { "x-role": role } });
      assert.equal(response.status, 200);
    }
    assert.equal(handlerCalls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("legacy employee is denied broad unscoped surfaces before production middleware dispatch", async () => {
  const app = express();
  let handlerCalls = 0;
  app.use((req, _res, next) => {
    (req as any).user = { id: "legacy-tech", role: "employee" };
    next();
  });
  app.use(authorizeApiRequest);
  for (const path of [
    "/dashboard",
    "/tasks",
    "/quotes",
    "/estimate-calendar",
    "/estimate-employees",
    "/team-users/active",
    "/crews",
    "/activity-logs",
    "/attachments",
    "/invoices",
    "/payments",
    "/financial-reconciliation",
  ]) {
    app.get(path, (_req, res) => {
      handlerCalls += 1;
      res.status(204).end();
    });
  }
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    for (const path of [
      "/dashboard",
      "/tasks",
      "/quotes",
      "/estimate-calendar",
      "/estimate-employees",
      "/team-users/active",
      "/crews",
      "/activity-logs",
      "/attachments",
      "/invoices",
      "/payments",
      "/financial-reconciliation",
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 403, path);
    }
    assert.equal(handlerCalls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});