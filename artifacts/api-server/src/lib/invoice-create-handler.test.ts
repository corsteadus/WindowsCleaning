import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvoicePostHandler } from "./invoice-create-handler.ts";

function responseFake() {
  return {
    code: 0,
    body: null as unknown,
    headers: new Map<string, string>(),
    status(code: number) {
      this.code = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  } as any;
}

function invoiceAdapter() {
  return {
    acquireJobLocks: async () => {},
    findJobsByIds: async () => [],
    insertInvoice: async (values: Record<string, unknown>) => ({
      id: 81,
      ...values,
      createdAt: new Date("2026-08-15T12:00:00.000Z"),
      updatedAt: new Date("2026-08-15T12:00:00.000Z"),
    }),
    insertInvoiceJob: async () => {},
    insertInvoiceLine: async () => {},
  } as any;
}

function requestFake(status: string) {
  return {
    body: {
      customerId: 7,
      status,
      lines: [{ description: "Exterior service", quantity: 1, unitPrice: "25.00", taxRate: "0" }],
    },
    user: undefined,
    get: () => undefined,
  } as any;
}

test("sent invoice creation emits inside the injected transaction", async () => {
  const events: unknown[] = [];
  const handler = createInvoicePostHandler({
    transaction: async (callback) => callback({
      createInvoiceAdapter: invoiceAdapter,
      enqueueCommunicationEvent: async (input: unknown) => {
        events.push(input);
        return {};
      },
      claimIdempotencyKey: async () => { throw new Error("idempotency should not be called"); },
      completeIdempotencyKey: async () => {},
    }),
    findInvoiceById: async () => undefined,
    enrichInvoices: async (invoices) => invoices,
  });
  const res = responseFake();

  await handler(requestFake("sent"), res);

  assert.equal(res.code, 201);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    eventType: "invoice.sent",
    aggregateType: "invoice",
    aggregateId: 81,
    payload: { customerId: 7, invoiceId: 81, status: "sent" },
    source: "invoices.create",
    idempotencyKey: null,
    dedupeKey: "invoice.sent:81:2026-08-15T12:00:00.000Z",
  });
});

test("event persistence failure rolls back the injected invoice transaction", async () => {
  let rolledBack = false;
  const handler = createInvoicePostHandler({
    transaction: async (callback) => {
      try {
        return await callback({
          createInvoiceAdapter: invoiceAdapter,
          enqueueCommunicationEvent: async () => { throw new Error("outbox unavailable"); },
          claimIdempotencyKey: async () => { throw new Error("idempotency should not be called"); },
          completeIdempotencyKey: async () => {},
        });
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
    findInvoiceById: async () => undefined,
    enrichInvoices: async (invoices) => invoices,
  });
  const res = responseFake();

  await handler(requestFake("sent"), res);

  assert.equal(res.code, 500);
  assert.equal(rolledBack, true);
});

test("invoice creation resolves the effective default and preserves explicit clearing", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const adapter = {
    ...invoiceAdapter(),
    insertInvoice: async (values: Record<string, unknown>) => {
      inserted.push(values);
      return {
        id: inserted.length,
        ...values,
        createdAt: new Date("2026-08-15T12:00:00.000Z"),
        updatedAt: new Date("2026-08-15T12:00:00.000Z"),
      };
    },
  } as any;
  const handler = createInvoicePostHandler({
    transaction: async (callback) => callback({
      createInvoiceAdapter: () => adapter,
      resolvePropertyId: async (_customerId, requestedPropertyId) =>
        requestedPropertyId === undefined ? 222 : requestedPropertyId,
      enqueueCommunicationEvent: async () => ({}),
      claimIdempotencyKey: async () => { throw new Error("idempotency should not be called"); },
      completeIdempotencyKey: async () => {},
    }),
    findInvoiceById: async () => undefined,
    enrichInvoices: async (invoices) => invoices,
  });

  const defaultRequest = requestFake("draft");
  await handler(defaultRequest, responseFake());
  const clearRequest = requestFake("draft");
  clearRequest.body.propertyId = null;
  await handler(clearRequest, responseFake());

  assert.equal(inserted[0]?.propertyId, 222);
  assert.equal(inserted[1]?.propertyId, null);
});