import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import express, { type Express } from "express";
import { test } from "node:test";
import router from "./communication-safety.ts";

function appFor(role?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (role) {
      (req as any).user = {
        id: "route-test-user",
        role,
        email: `${role}@example.test`,
        firstName: role,
        lastName: "Tester",
      };
    }
    next();
  });
  app.use("/api", router);
  return app;
}

async function requestJson(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          port: address.port,
          method,
          path,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { raw += chunk; });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(raw || "{}") as Record<string, unknown>,
            });
          });
        },
      );
      request.on("error", reject);
      if (body !== undefined) request.write(JSON.stringify(body));
      request.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("communication safety routes deny anonymous access", async () => {
  const response = await requestJson(
    appFor(),
    "GET",
    "/api/customers/1/communication-safety",
  );
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "unauthorized");
});

test("employee cannot enumerate suppressions or manage organization quiet hours", async () => {
  const suppressions = await requestJson(
    appFor("employee"),
    "GET",
    "/api/communication-safety/suppressions",
  );
  assert.equal(suppressions.status, 403);
  assert.equal(suppressions.body.capability, "communication.settings");

  const quietHours = await requestJson(
    appFor("employee"),
    "PUT",
    "/api/communication-safety/quiet-hours",
    { timezone: "America/Chicago" },
  );
  assert.equal(quietHours.status, 403);
  assert.equal(quietHours.body.capability, "communication.settings");
});

test("employee cannot reach customer communication preference management", async () => {
  const response = await requestJson(
    appFor("employee"),
    "POST",
    "/api/customers/1/communication-safety/consent",
    { channel: "email" },
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.capability, "communication.manage");
});

test("settings validation rejects invalid timezone before any write", async () => {
  const response = await requestJson(
    appFor("owner"),
    "PUT",
    "/api/communication-safety/quiet-hours",
    { timezone: "Not/A_Timezone" },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid IANA timezone");
});

test("suppression creation rejects missing idempotency before opening a transaction", async () => {
  const response = await requestJson(
    appFor("owner"),
    "POST",
    "/api/communication-safety/suppressions",
    {
      channel: "email",
      destination: "person@example.com",
      reason: "manual",
      scope: "global",
    },
  );
  assert.equal(response.status, 400);
  assert.match(String(response.body.error), /Idempotency-Key/);
});