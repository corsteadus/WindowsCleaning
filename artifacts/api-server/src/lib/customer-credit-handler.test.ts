import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomerCreditApplicationPostHandler, createCustomerCreditRefundPostHandler } from "./customer-credit-handler.ts";
import type {
  CustomerCreditAdapter,
  CustomerCreditInvoiceRow,
  CustomerCreditPaymentRow,
  CustomerCreditSourceRow,
} from "./customer-credit-core.ts";

function request(body: unknown, key?: string) {
  return {
    body,
    user: undefined,
    get: (name: string) => name.toLowerCase() === "idempotency-key" ? key : undefined,
  } as any;
}

function response() {
  const state = { statusCode: 200, headers: new Map<string, string>(), body: undefined as unknown };
  return {
    state,
    status(code: number) { state.statusCode = code; return this; },
    setHeader(name: string, value: string) { state.headers.set(name, value); return this; },
    json(body: unknown) { state.body = body; return this; },
  } as any;
}

function dependencies(claimKind: "replay" | "conflict" | "inProgress" = "replay") {
  return {
    transaction: async (callback: any) => callback({
      createCustomerCreditAdapter: () => { throw new Error("adapter should not run in replay/conflict test"); },
      claimIdempotencyKey: async () => claimKind === "replay"
        ? { kind: "replay", record: { id: 1, requestHash: "hash", status: "completed", resourceId: 7, responseStatus: 200 } }
        : claimKind === "conflict"
          ? { kind: "conflict", record: { id: 1, requestHash: "other", status: "completed", resourceId: 7, responseStatus: 200 } }
          : { kind: "inProgress", record: { id: 1, requestHash: "hash", status: "in_progress", resourceId: null, responseStatus: null } },
      completeIdempotencyKey: async () => {},
    }),
    getPerformedBy: () => null,
    createRefundNumber: () => "REF-TEST",
    getCustomerCreditSummary: async (customerId: number) => ({ customerId, sources: [], applications: [], refunds: [] }),
    getRefundDetail: async (refundId: number) => ({ id: refundId, amount: 1 }),
  };
}

test("customer credit mutations require Idempotency-Key", async () => {
  const applyResponse = response();
  await createCustomerCreditApplicationPostHandler(dependencies() as any)(
    request({ customerId: 7, mode: "oldest", amount: "1.00" }),
    applyResponse,
  );
  assert.equal(applyResponse.state.statusCode, 400);
  assert.equal((applyResponse.state.body as any).code, "idempotency_key_required");

  const refundResponse = response();
  await createCustomerCreditRefundPostHandler(dependencies() as any)(
    request({ customerId: 7, amount: "1.00", refundDate: "2026-08-14", method: "check", reason: "test" }),
    refundResponse,
  );
  assert.equal(refundResponse.state.statusCode, 400);
  assert.equal((refundResponse.state.body as any).code, "idempotency_key_required");
});

test("customer credit application replays canonically and marks the response", async () => {
  const res = response();
  await createCustomerCreditApplicationPostHandler(dependencies() as any)(
    request({ customerId: 7, mode: "oldest", amount: "1.00" }, "credit-replay"),
    res,
  );
  assert.equal(res.state.statusCode, 200);
  assert.equal(res.state.headers.get("Idempotency-Replayed"), "true");
  assert.equal((res.state.body as any).customerId, 7);
});

test("customer credit refund returns 409 for idempotency conflict", async () => {
  const res = response();
  await createCustomerCreditRefundPostHandler(dependencies("conflict") as any)(
    request({ customerId: 7, amount: "1.00", refundDate: "2026-08-14", method: "check", reason: "test" }, "credit-conflict"),
    res,
  );
  assert.equal(res.state.statusCode, 409);
});

test("customer credit mutation returns 409 with Retry-After while the same key is in progress", async () => {
  const res = response();
  await createCustomerCreditApplicationPostHandler(dependencies("inProgress") as any)(
    request({ customerId: 7, mode: "oldest", amount: "1.00" }, "credit-busy"),
    res,
  );
  assert.equal(res.state.statusCode, 409);
  assert.equal(res.state.headers.get("Retry-After"), "1");
  assert.equal((res.state.body as any).error, "An identical request is already in progress");
});

type HandlerHarnessOptions = {
  failure?: "application" | "refund";
};

type HandlerHarnessState = {
  sources: CustomerCreditSourceRow[];
  invoices: Map<number, CustomerCreditInvoiceRow>;
  payments: Map<number, CustomerCreditPaymentRow>;
  applications: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  refundAllocations: Array<Record<string, unknown>>;
  keys: Map<string, {
    id: number;
    requestHash: string;
    status: "in_progress" | "completed";
    resourceId: number | null;
    responseStatus: number | null;
  }>;
  nextId: number;
};

function makeHandlerHarness(options: HandlerHarnessOptions = {}) {
  const source = (): CustomerCreditSourceRow => ({
    sourceKey: "credit_note:11",
    sourceType: "credit_note",
    sourceId: 11,
    customerId: 7,
    originalAmount: "10.00",
    availableAmount: "10.00",
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  const state: HandlerHarnessState = {
    sources: [source()],
    invoices: new Map([[1, {
      id: 1,
      customerId: 7,
      totalAmount: "10.00",
      amountPaid: "0.00",
      balanceDue: "10.00",
      status: "sent",
      dueDate: "2026-08-01",
      serviceDate: null,
      paidAt: null,
    }]]),
    payments: new Map(),
    applications: [],
    refunds: [],
    refundAllocations: [],
    keys: new Map(),
    nextId: 1,
  };
  const adapter: CustomerCreditAdapter = {
    acquireCustomerLock: async () => {},
    acquireSourceLocks: async () => {},
    acquireInvoiceLocks: async () => {},
    findSources: async () => state.sources.map((item) => ({ ...item })),
    findInvoicesByIds: async (ids) => ids.map((id) => state.invoices.get(id)).filter(Boolean) as CustomerCreditInvoiceRow[],
    findOpenInvoicesByCustomer: async (customerId) =>
      [...state.invoices.values()].filter((invoice) => invoice.customerId === customerId && invoice.balanceDue !== "0.00"),
    findPaymentById: async (id) => state.payments.get(id) ?? null,
    insertApplication: async (values) => {
      state.applications.push({ ...values });
      if (options.failure === "application") throw new Error("injected application persistence failure");
      const sourceRow = state.sources.find((item) => item.sourceKey === values.sourceKey)!;
      sourceRow.availableAmount = (Number(sourceRow.availableAmount) - Number(values.amount)).toFixed(2);
      return { id: state.applications.length };
    },
    updateInvoice: async (id, values) => {
      const updated = { ...state.invoices.get(id)!, ...values };
      state.invoices.set(id, updated);
      return updated;
    },
    updatePayment: async (id, values) => {
      const updated = { ...state.payments.get(id)!, ...values };
      state.payments.set(id, updated);
      return updated;
    },
    insertPaymentAllocation: async () => ({ id: 1 }),
    insertRefund: async (values) => {
      const id = state.nextId++;
      state.refunds.push({ id, ...values });
      return { id };
    },
    insertRefundAllocation: async (values) => {
      state.refundAllocations.push({ ...values });
      if (options.failure === "refund") throw new Error("injected refund allocation persistence failure");
      const sourceRow = state.sources.find((item) => item.sourceKey === values.sourceKey)!;
      sourceRow.availableAmount = (Number(sourceRow.availableAmount) - Number(values.amount)).toFixed(2);
      return { id: state.refundAllocations.length };
    },
  };

  const cloneState = () => structuredClone(state);
  const restoreState = (snapshot: HandlerHarnessState) => {
    state.sources = snapshot.sources;
    state.invoices = snapshot.invoices;
    state.payments = snapshot.payments;
    state.applications = snapshot.applications;
    state.refunds = snapshot.refunds;
    state.refundAllocations = snapshot.refundAllocations;
    state.keys = snapshot.keys;
    state.nextId = snapshot.nextId;
  };
  let transactionTail = Promise.resolve();
  const dependencies = {
    transaction: async (callback: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = cloneState();
      try {
        return await callback({
          createCustomerCreditAdapter: () => adapter,
          claimIdempotencyKey: async (input: any) => {
            const key = `${input.scope}:${input.operation}:${input.clientKey}`;
            const existing = state.keys.get(key);
            if (existing) {
              if (existing.requestHash !== input.requestHash) return { kind: "conflict", record: existing };
              if (existing.status === "completed") return { kind: "replay", record: existing };
              return { kind: "inProgress", record: existing };
            }
            const record = {
              id: state.nextId++,
              requestHash: input.requestHash,
              status: "in_progress" as const,
              resourceId: null,
              responseStatus: null,
            };
            state.keys.set(key, record);
            return { kind: "claimed", record };
          },
          completeIdempotencyKey: async (id: number, completion: any) => {
            for (const record of state.keys.values()) {
              if (record.id === id) {
                record.status = "completed";
                record.resourceId = completion.resourceId;
                record.responseStatus = completion.responseStatus;
              }
            }
          },
        });
      } catch (error) {
        restoreState(snapshot);
        throw error;
      } finally {
        release();
      }
    },
    getPerformedBy: () => null,
    createRefundNumber: () => `REF-7-${state.nextId}`,
    getCustomerCreditSummary: async (customerId: number) => ({
      customerId,
      sources: state.sources,
      applications: state.applications,
      refunds: state.refunds,
    }),
    getRefundDetail: async (refundId: number) => state.refunds.find((refund) => refund.id === refundId) ?? null,
  };
  return { state, dependencies };
}

test("same-key concurrent customer-credit requests create one application and replay the other", async () => {
  const harness = makeHandlerHarness();
  const handler = createCustomerCreditApplicationPostHandler(harness.dependencies as any);
  const body = { customerId: 7, mode: "oldest", amount: "1.00" };
  const firstResponse = response();
  const secondResponse = response();
  const [first, second] = await Promise.all([
    handler(request(body, "credit-concurrent"), firstResponse),
    handler(request(body, "credit-concurrent"), secondResponse),
  ]);

  assert.equal(harness.state.applications.length, 1);
  assert.deepEqual(
    [firstResponse.state.statusCode, secondResponse.state.statusCode].sort((a, b) => a - b),
    [200, 200],
  );
  assert.equal(
    [firstResponse, secondResponse].filter((result) => result.state.headers.get("Idempotency-Replayed") === "true").length,
    1,
  );
});

test("application persistence failure rolls back invoice, ledger, and idempotency state", async () => {
  const harness = makeHandlerHarness({ failure: "application" });
  const beforeInvoice = structuredClone(harness.state.invoices.get(1));
  const beforeSources = structuredClone(harness.state.sources);
  const res = response();
  await createCustomerCreditApplicationPostHandler(harness.dependencies as any)(
    request({ customerId: 7, mode: "oldest", amount: "1.00" }, "credit-application-failure"),
    res,
  );

  assert.equal(res.state.statusCode, 500);
  assert.deepEqual(harness.state.invoices.get(1), beforeInvoice);
  assert.deepEqual(harness.state.sources, beforeSources);
  assert.equal(harness.state.applications.length, 0);
  assert.equal(harness.state.keys.size, 0);
});

test("refund persistence failure rolls back refund, allocation, source, and idempotency state", async () => {
  const harness = makeHandlerHarness({ failure: "refund" });
  const beforeSources = structuredClone(harness.state.sources);
  const res = response();
  await createCustomerCreditRefundPostHandler(harness.dependencies as any)(
    request({
      customerId: 7,
      amount: "1.00",
      refundDate: "2026-08-14",
      method: "check",
      reason: "Injected failure",
      mode: "oldest",
    }, "credit-refund-failure"),
    res,
  );

  assert.equal(res.state.statusCode, 500);
  assert.deepEqual(harness.state.sources, beforeSources);
  assert.equal(harness.state.refunds.length, 0);
  assert.equal(harness.state.refundAllocations.length, 0);
  assert.equal(harness.state.keys.size, 0);
});