import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { test } from "node:test";
import express, { Router, type Express } from "express";
import {
  createInvoiceCreditNotePostHandler,
  createInvoiceReissuePostHandler,
  createVoidInvoicePostHandler,
  type InvoiceCorrectionRouteDependencies,
  type InvoiceCorrectionRouteTransaction,
} from "./invoice-correction-handler.ts";
import type {
  CorrectionInvoiceAdapter,
  CorrectionInvoiceRow,
  CorrectionLineRow,
} from "./invoice-correction-core.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");

type StoredKey = {
  id: number;
  scope: string;
  operation: string;
  clientKey: string;
  requestHash: string;
  status: string;
  resourceId: number | null;
  responseStatus: number | null;
};

type HttpResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

function sourceInvoice(status: string): CorrectionInvoiceRow {
  return {
    id: 1,
    customerId: 7,
    jobId: 101,
      propertyId: null,
    invoiceNumber: "INV-1",
    status,
    subtotal: "100.00",
    taxAmount: "0.00",
    totalAmount: "100.00",
    amountPaid: "0.00",
    balanceDue: status === "voided" ? "0.00" : "100.00",
    dueDate: "2026-09-13",
    paidAt: null,
    notes: "Original notes",
    lineItems: null,
  };
}

class CorrectionHttpHarness {
  invoices: CorrectionInvoiceRow[];
  readonly lines: CorrectionLineRow[] = [{
    id: 11,
    invoiceId: 1,
    jobId: 101,
    description: "Exterior",
    quantity: "1",
    unitPrice: "100.00",
    discountAmount: "0.00",
    taxAmount: "0.00",
    lineTotal: "100.00",
    sortOrder: 0,
  }];
  readonly voids: Array<Record<string, unknown>> = [];
  readonly creditNotes: Array<Record<string, unknown>> = [];
  readonly creditLines: Array<Record<string, unknown>> = [];
  readonly reissues: Array<Record<string, unknown>> = [];
  failureAfterCreditWrite = false;
  private nextInvoiceId = 2;
  private nextId = 1;
  private readonly keys = new Map<string, StoredKey>();
  private transactionTail = Promise.resolve();

  constructor(status: string) {
    this.invoices = [sourceInvoice(status)];
  }

  readonly dependencies: InvoiceCorrectionRouteDependencies = {
    transaction: (callback) => this.transaction(callback),
    findInvoiceById: async (id) => this.invoices.find((invoice) => invoice.id === id) ?? null,
    enrichInvoices: async (invoices) => invoices.map((invoice) => ({
      ...(invoice as CorrectionInvoiceRow),
      correctionHistory: {
        void: this.voids.find((record) => record.invoiceId === (invoice as CorrectionInvoiceRow).id) ?? null,
        creditNotes: this.creditNotes.filter((record) => record.invoiceId === (invoice as CorrectionInvoiceRow).id),
        reissue: this.reissues.find((record) => record.sourceInvoiceId === (invoice as CorrectionInvoiceRow).id) ?? null,
        replacementOf: this.reissues.find((record) => record.replacementInvoiceId === (invoice as CorrectionInvoiceRow).id) ?? null,
      },
    })),
    getPerformedBy: () => "Kyle",
    createCreditNumber: (id) => `CN-${id}-TEST`,
    createReissueNumber: (id) => `INV-REISSUE-${id}-TEST`,
  };

  async transaction<T>(callback: (tx: InvoiceCorrectionRouteTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = {
      invoices: this.invoices.map((invoice) => ({ ...invoice })),
      voids: this.voids.length,
      creditNotes: this.creditNotes.length,
      creditLines: this.creditLines.length,
      reissues: this.reissues.length,
      keys: new Map([...this.keys.entries()].map(([key, value]) => [key, { ...value }])),
    };
    try {
      return await callback({
        createCorrectionAdapter: () => this.adapter(),
        claimIdempotencyKey: async (input) => {
          const key = `${input.scope}:${input.operation}:${input.clientKey}`;
          const existing = this.keys.get(key);
          if (existing) {
            if (existing.requestHash !== input.requestHash) return { kind: "conflict", record: existing };
            if (existing.status === "completed") return { kind: "replay", record: existing };
            return { kind: "inProgress", record: existing };
          }
          const record: StoredKey = {
            id: this.nextId++,
            scope: input.scope,
            operation: input.operation,
            clientKey: input.clientKey,
            requestHash: input.requestHash,
            status: "in_progress",
            resourceId: null,
            responseStatus: null,
          };
          this.keys.set(key, record);
          return { kind: "claimed", record };
        },
        completeIdempotencyKey: async (id, completion) => {
          for (const record of this.keys.values()) {
            if (record.id === id) Object.assign(record, {
              status: "completed",
              resourceId: completion.resourceId,
              responseStatus: completion.responseStatus,
            });
          }
        },
      });
    } catch (error) {
      this.invoices = snapshot.invoices;
      this.voids.length = snapshot.voids;
      this.creditNotes.length = snapshot.creditNotes;
      this.creditLines.length = snapshot.creditLines;
      this.reissues.length = snapshot.reissues;
      this.keys.clear();
      for (const [key, value] of snapshot.keys) this.keys.set(key, value);
      throw error;
    } finally {
      release();
    }
  }

  private adapter(): CorrectionInvoiceAdapter {
    return {
      acquireInvoiceLock: async () => {},
      findInvoiceById: async (id) => this.invoices.find((invoice) => invoice.id === id) ?? null,
      hasPaymentAllocations: async () => false,
      findInvoiceLines: async () => this.lines,
      findCreditLines: async () => this.creditLines.map((line) => ({
        invoiceLineId: line.invoiceLineId as number | null,
        creditAmount: line.creditAmount as string,
      })),
      insertVoid: async (values) => {
        this.voids.push({ id: this.nextId++, ...values, voidedAt: NOW.toISOString() });
        return { id: this.nextId };
      },
      insertCreditNote: async (values) => {
        const record = { id: this.nextId++, ...values, createdAt: NOW.toISOString() };
        this.creditNotes.push(record);
        return record as { id: number };
      },
      insertCreditLine: async (values) => {
        this.creditLines.push({ id: this.nextId++, ...values, createdAt: NOW.toISOString() });
        if (this.failureAfterCreditWrite) throw new Error("injected credit-line persistence failure");
      },
      updateInvoice: async (id, values) => {
        const index = this.invoices.findIndex((invoice) => invoice.id === id);
        if (index < 0) throw new Error("invoice missing");
        this.invoices[index] = { ...this.invoices[index], ...values };
        return this.invoices[index];
      },
      findLinkedJobIds: async () => [101],
      findActiveReissue: async (sourceInvoiceId) =>
        (this.reissues.find((record) => record.sourceInvoiceId === sourceInvoiceId && record.isActive) as { id: number; replacementInvoiceId: number } | undefined) ?? null,
      insertReplacementInvoice: async (values) => {
        const replacement = {
          id: this.nextInvoiceId++,
          ...values,
          paidAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        } as CorrectionInvoiceRow;
        this.invoices.push(replacement);
        return replacement;
      },
      insertReplacementJob: async () => {},
      insertReplacementLine: async () => {},
      insertReissue: async (values) => {
        const record = { id: this.nextId++, ...values, isActive: true, createdAt: NOW.toISOString() };
        this.reissues.push(record);
        return record as { id: number };
      },
    };
  }
}

async function startHarness(harness: CorrectionHttpHarness, route: "void" | "credit" | "reissue"): Promise<{
  post(path: string, body: unknown, idempotencyKey?: string): Promise<HttpResponse>;
  close(): Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const router = Router();
  const handler = route === "void"
    ? createVoidInvoicePostHandler(harness.dependencies)
    : route === "credit"
      ? createInvoiceCreditNotePostHandler(harness.dependencies)
      : createInvoiceReissuePostHandler(harness.dependencies);
  router.post(
    route === "void"
      ? "/invoices/:id/void"
      : route === "credit"
        ? "/invoices/:id/credit-notes"
        : "/invoices/:id/reissue",
    handler,
  );
  app.use("/api", router);
  const server = await listen(app);
  return {
    post: (path, body, idempotencyKey) => request(server, path, body, idempotencyKey),
    close: () => close(server),
  };
}

function listen(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(server: Server, path: string, body: unknown, idempotencyKey?: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Test server did not expose a TCP address"));
      return;
    }
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: `/api${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: raw ? JSON.parse(raw) : null,
      }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const scenarios = [
  {
    name: "void",
    sourceStatus: "sent",
    body: { reason: "Duplicate invoice" },
    path: "/invoices/1/void",
    expectedStatus: 200,
    effectCount: (harness: CorrectionHttpHarness) => harness.voids.length,
  },
  {
    name: "credit note",
    sourceStatus: "sent",
    body: { reason: "Courtesy credit", lines: [{ invoiceLineId: 11, amount: "10.01" }] },
    path: "/invoices/1/credit-notes",
    expectedStatus: 201,
    effectCount: (harness: CorrectionHttpHarness) => harness.creditNotes.length,
  },
  {
    name: "reissue",
    sourceStatus: "voided",
    body: { reason: "Corrected address" },
    path: "/invoices/1/reissue",
    expectedStatus: 201,
    effectCount: (harness: CorrectionHttpHarness) => harness.reissues.length,
  },
] as const;

for (const scenario of scenarios) {
  test(`${scenario.name} route requires Idempotency-Key`, async () => {
    const harness = new CorrectionHttpHarness(scenario.sourceStatus);
    const http = await startHarness(harness, scenario.name === "credit note" ? "credit" : scenario.name);
    try {
      const response = await http.post(scenario.path, scenario.body);
      assert.equal(response.status, 400);
      assert.equal(response.body.code, "idempotency_key_required");
      assert.equal(scenario.effectCount(harness), 0);
    } finally {
      await http.close();
    }
  });

  test(`${scenario.name} route replays the enriched canonical response`, async () => {
    const harness = new CorrectionHttpHarness(scenario.sourceStatus);
    const http = await startHarness(harness, scenario.name === "credit note" ? "credit" : scenario.name);
    try {
      const first = await http.post(scenario.path, scenario.body, `${scenario.name}-replay`);
      const replay = await http.post(scenario.path, scenario.body, `${scenario.name}-replay`);
      assert.equal(first.status, scenario.expectedStatus);
      assert.equal(replay.status, scenario.expectedStatus);
      assert.equal(replay.headers["idempotency-replayed"], "true");
      assert.deepEqual(replay.body, first.body);
      assert.equal(scenario.effectCount(harness), 1);
    } finally {
      await http.close();
    }
  });

  test(`${scenario.name} route rejects a mismatched payload with 409`, async () => {
    const harness = new CorrectionHttpHarness(scenario.sourceStatus);
    const http = await startHarness(harness, scenario.name === "credit note" ? "credit" : scenario.name);
    try {
      await http.post(scenario.path, scenario.body, `${scenario.name}-conflict`);
      const changed = scenario.name === "credit note"
        ? { ...scenario.body, reason: "Different reason" }
        : { reason: "Different reason" };
      const conflict = await http.post(scenario.path, changed, `${scenario.name}-conflict`);
      assert.equal(conflict.status, 409);
      assert.equal(scenario.effectCount(harness), 1);
    } finally {
      await http.close();
    }
  });

  test(`${scenario.name} route has one effect under concurrent same-key requests`, async () => {
    const harness = new CorrectionHttpHarness(scenario.sourceStatus);
    const http = await startHarness(harness, scenario.name === "credit note" ? "credit" : scenario.name);
    try {
      const [first, concurrent] = await Promise.all([
        http.post(scenario.path, scenario.body, `${scenario.name}-concurrent`),
        http.post(scenario.path, scenario.body, `${scenario.name}-concurrent`),
      ]);
      assert.equal(first.status, scenario.expectedStatus);
      assert.equal(concurrent.status, scenario.expectedStatus);
      assert.equal([first, concurrent].filter((response) => response.headers["idempotency-replayed"] === "true").length, 1);
      assert.equal(scenario.effectCount(harness), 1);
    } finally {
      await http.close();
    }
  });
}

test("credit route transaction rollback removes records after an injected persistence failure", async () => {
  const harness = new CorrectionHttpHarness("sent");
  harness.failureAfterCreditWrite = true;
  const http = await startHarness(harness, "credit");
  try {
    const response = await http.post(
      "/invoices/1/credit-notes",
      { reason: "Injected failure", lines: [{ invoiceLineId: 11, amount: "10.00" }] },
      "credit-rollback",
    );
    assert.equal(response.status, 500);
    assert.equal(harness.creditNotes.length, 0);
    assert.equal(harness.creditLines.length, 0);
    assert.equal(harness.invoices[0].status, "sent");
    assert.equal(harness.invoices[0].balanceDue, "100.00");
  } finally {
    await http.close();
  }
});

test("concurrent reissues with distinct keys leave one active replacement", async () => {
  const harness = new CorrectionHttpHarness("voided");
  const http = await startHarness(harness, "reissue");
  try {
    const [first, second] = await Promise.all([
      http.post("/invoices/1/reissue", { reason: "Replacement A" }, "reissue-a"),
      http.post("/invoices/1/reissue", { reason: "Replacement B" }, "reissue-b"),
    ]);
    assert.equal([first, second].filter((response) => response.status === 201).length, 1);
    assert.equal([first, second].filter((response) => response.status === 400).length, 1);
    assert.equal(harness.reissues.length, 1);
  } finally {
    await http.close();
  }
});