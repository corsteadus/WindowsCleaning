import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import express from "express";
import {
  createEstimateAppointmentRouter,
  createEstimateEmployeesRouter,
  type EstimateAppointmentInput,
  type EstimateAppointmentRepository,
} from "./estimates.ts";
import { persistScheduledQuoteCore } from "../lib/quote-scheduled-create.ts";
import { authorizeApiRequest } from "../lib/authorization.ts";

const STARTS_AT = "2026-09-17T14:35:00-05:00";

class AppointmentContractRepository implements EstimateAppointmentRepository {
  readonly quotes = new Map([[41, { id: 41, customerId: 7, status: "draft" }]]);
  readonly properties = new Map([
    [101, { customerId: 7, archived: false }],
    [102, { customerId: 7, archived: false }],
    [201, { customerId: 8, archived: false }],
    [301, { customerId: 7, archived: true }],
  ]);
  readonly users = new Map([
    ["field", { role: "field_tech", active: true }],
    ["legacy", { role: "team_tech", active: true }],
    ["admin", { role: "admin", active: true }],
    ["office", { role: "office_staff", active: true }],
    ["inactive", { role: "field_tech", active: false }],
  ]);
  appointment: any = null;
  propertyIds: number[] = [];
  writes = 0;

  async findQuote(quoteId: number) {
    return this.quotes.get(quoteId) ?? null;
  }

  async findActiveOwnedPropertyIds(customerId: number, propertyIds: number[]) {
    return propertyIds.filter((propertyId) => {
      const property = this.properties.get(propertyId);
      return property?.customerId === customerId && !property.archived;
    });
  }

  async findActiveTechnician(userId: string) {
    const user = this.users.get(userId);
    return user?.active ? { id: userId, role: user.role } : null;
  }

  async saveAppointment(input: EstimateAppointmentInput) {
    this.writes += 1;
    this.propertyIds = [...input.propertyIds];
    this.appointment = {
      quoteId: input.quote.id,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      assignedUserId: input.assignedUserId,
      appointmentNotes: input.appointmentNotes,
      estimateNotes: input.estimateNotes,
    };
    return this.appointment;
  }

  async getLifecycle() {
    return {
      status: this.appointment ? "scheduled" : "draft",
      appointment: this.appointment,
      revision: null,
      publicLink: null,
      locations: this.propertyIds.map((propertyId) => ({ quoteId: 41, propertyId })),
      deliveries: [],
      activities: [],
    };
  }
}

async function withHttp(
  repository: AppointmentContractRepository,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use(createEstimateAppointmentRouter(repository));
  const server: Server = createServer(app);
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    startsAt: STARTS_AT,
    durationMinutes: 75,
    assignedUserId: "field",
    propertyIds: [102, 101, 102],
    appointmentNotes: "Use the side gate",
    estimateNotes: "Measure upper panes",
    ...overrides,
  };
}

async function post(baseUrl: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/quotes/41/appointment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("estimate appointment HTTP contract", () => {
  test("rejects missing, null, and blank assignees without writes", async () => {
    for (const assignedUserId of [undefined, null, "   "]) {
      const repository = new AppointmentContractRepository();
      await withHttp(repository, async (baseUrl) => {
        const body = validBody();
        if (assignedUserId === undefined) delete body.assignedUserId;
        else body.assignedUserId = assignedUserId as any;
        const response = await post(baseUrl, body);
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /technician/i);
        assert.equal(repository.writes, 0);
      });
    }
  });

  test("rejects admin, non-tech, and inactive technicians without writes", async () => {
    for (const assignedUserId of ["admin", "office", "inactive"]) {
      const repository = new AppointmentContractRepository();
      await withHttp(repository, async (baseUrl) => {
        const response = await post(baseUrl, validBody({ assignedUserId }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /active Field Tech/i);
        assert.equal(repository.writes, 0);
      });
    }
  });

  test("rejects empty, unowned, and archived locations without writes", async () => {
    for (const propertyIds of [[], [201], [301]]) {
      const repository = new AppointmentContractRepository();
      await withHttp(repository, async (baseUrl) => {
        const response = await post(baseUrl, validBody({ propertyIds }));
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /location/i);
        assert.equal(repository.writes, 0);
      });
    }
  });

  test("accepts canonical and legacy Field Tech roles and round-trips canonical values", async () => {
    for (const assignedUserId of ["field", "legacy"]) {
      const repository = new AppointmentContractRepository();
      await withHttp(repository, async (baseUrl) => {
        const createdResponse = await post(baseUrl, validBody({ assignedUserId }));
        assert.equal(createdResponse.status, 201);
        const created = await createdResponse.json();
        assert.equal(created.startsAt, "2026-09-17T19:35:00.000Z");
        assert.equal(created.assignedUserId, assignedUserId);
        assert.equal(created.durationMinutes, 75);
        assert.equal(created.appointmentNotes, "Use the side gate");
        assert.equal(created.estimateNotes, "Measure upper panes");
        assert.deepEqual(created.propertyIds, [102, 101]);
        assert.equal(repository.writes, 1);

        const lifecycleResponse = await fetch(`${baseUrl}/quotes/41/estimate-lifecycle`);
        assert.equal(lifecycleResponse.status, 200);
        const lifecycle = await lifecycleResponse.json();
        assert.equal(lifecycle.appointment.startsAt, "2026-09-17T19:35:00.000Z");
        assert.equal(lifecycle.appointment.assignedUserId, assignedUserId);
        assert.equal(lifecycle.appointment.durationMinutes, 75);
        assert.equal(lifecycle.appointment.appointmentNotes, "Use the side gate");
        assert.equal(lifecycle.appointment.estimateNotes, "Measure upper panes");
        assert.deepEqual(lifecycle.appointment.propertyIds, [102, 101]);
        assert.deepEqual(lifecycle.locations.map((location: any) => location.propertyId), [102, 101]);
      });
    }
  });
});

test("Sales can load estimate employees with active-state evidence for scheduled quote creation", async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = { id: "sales-1", role: "sales" };
    next();
  });
  app.use(authorizeApiRequest);
  app.use(createEstimateEmployeesRouter({
    async listActive() {
      return [{
        id: "field",
        firstName: "Avery",
        lastName: "Tech",
        role: "field_tech",
        isActive: true,
      }];
    },
  }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/estimate-employees`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
      id: "field",
      firstName: "Avery",
      lastName: "Tech",
      role: "field_tech",
      isActive: true,
      displayName: "Avery Tech",
    }]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()));
  }
});

test("scheduled quote endpoint keeps every quote and appointment write in one transaction", () => {
  const source = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('router.post("/quotes/with-appointment"');
  const routeEnd = source.indexOf('router.patch("/quotes/:id"', routeStart);
  const route = source.slice(routeStart, routeEnd);
  const transactionStart = route.indexOf("await db.transaction(async (tx)");
  const transactionEnd = route.indexOf("res.status(201).json");
  assert.ok(transactionStart >= 0);
  assert.ok(transactionEnd > transactionStart);
  const transaction = route.slice(transactionStart, transactionEnd);
  assert.match(transaction, /claimIdempotencyKey\(tx, idempotency\)/);
  assert.match(transaction, /persistScheduledQuoteCore(?:<[\s\S]*?>)?\(\{/);
  assert.match(transaction, /createQuote: \(\) => createQuoteTx\(tx,/);
  assert.match(transaction, /createAppointment\(quote\)/);
  assert.match(transaction, /createLocations: \(quote\)/);
  assert.match(transaction, /createActivity: \(quote\)/);
  assert.match(transaction, /async enqueueEvent\(quote\)/);
  assert.match(transaction, /completeIdempotency: \(quote\)/);
  assert.match(route, /hasCapability\(req\.user\?\.role, "estimates\.schedule"\)/);
  assert.match(route, /markIdempotencyReplay\(res\)/);
  assert.doesNotMatch(route, /getQuoteWithDetails/);
});

test("scheduled quote commit rolls back every aggregate stage on failure", async () => {
  const stages = [
    "validateReferences",
    "createQuote",
    "createAppointment",
    "createLocations",
    "createActivity",
    "enqueueEvent",
    "completeIdempotency",
  ] as const;
  type Stage = (typeof stages)[number];
  type State = Record<Stage, number>;
  const emptyState = (): State => Object.fromEntries(stages.map((stage) => [stage, 0])) as State;

  const runTransaction = async (failAt: Stage | null) => {
    let state = emptyState();
    const before = { ...state };
    const write = async (stage: Stage) => {
      state[stage] += 1;
      if (stage === failAt) throw new Error(`forced ${stage} failure`);
    };
    try {
      const result = await persistScheduledQuoteCore({
        validateReferences: () => write("validateReferences"),
        createQuote: async () => {
          await write("createQuote");
          return { id: 51 };
        },
        createAppointment: async (quote) => {
          assert.equal(quote.id, 51);
          await write("createAppointment");
          return { id: 71, quoteId: quote.id };
        },
        createLocations: () => write("createLocations"),
        createActivity: () => write("createActivity"),
        enqueueEvent: () => write("enqueueEvent"),
        completeIdempotency: () => write("completeIdempotency"),
      });
      return { result, state };
    } catch (error) {
      state = before;
      throw Object.assign(error as Error, { rolledBackState: state });
    }
  };

  const committed = await runTransaction(null);
  assert.deepEqual(committed.state, Object.fromEntries(stages.map((stage) => [stage, 1])));
  assert.deepEqual(committed.result, { quote: { id: 51 }, appointment: { id: 71, quoteId: 51 } });

  for (const stage of stages) {
    await assert.rejects(
      runTransaction(stage),
      (error: Error & { rolledBackState?: State }) => {
        assert.deepEqual(error.rolledBackState, emptyState());
        return true;
      },
    );
  }
});
