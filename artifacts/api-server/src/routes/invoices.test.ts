import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { test } from "node:test";
import express, { Router, type Express } from "express";
import {
  createInvoicePostHandler,
  type InvoiceCreateIdempotencyClaim,
  type InvoiceCreateIdempotencyCompletion,
  type InvoiceCreateRouteDependencies,
  type InvoiceCreateTransaction,
  type InvoiceCreateStoredInvoice,
} from "../lib/invoice-create-handler.ts";
import type {
  InvoiceCreateAdapter,
  InvoiceJobRow,
  InvoiceRow,
} from "../lib/invoice-core.ts";
const NOW = new Date("2026-08-14T12:00:00.000Z");

type StoredInvoice = InvoiceCreateStoredInvoice;
type StoredKey = {
  id: number;
  scope: string;
  operation: string;
  clientKey: string;
  requestHash: string;
  status: string;
  resourceType: string | null;
  resourceId: number | null;
  responseStatus: number | null;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
};

function fixtureJob(): InvoiceJobRow {
  return {
    id: 42,
    customerId: 7,
    jobNumber: "JOB-42",
    propertyId: 100,
    scheduledDate: "2026-08-14",
    totalAmount: "25.00",
    status: "completed",
  };
}

function asStoredInvoice(invoice: InvoiceRow): StoredInvoice {
  return {
    ...invoice,
    paidAt: null,
    createdAt: invoice.createdAt instanceof Date ? invoice.createdAt : new Date(invoice.createdAt),
    updatedAt: invoice.updatedAt instanceof Date ? invoice.updatedAt : new Date(invoice.updatedAt),
  };
}

class InvoiceHttpHarness {
  readonly jobs = [fixtureJob()];
  readonly invoices: StoredInvoice[] = [];
  readonly invoiceJobs: Array<{ invoiceId: number; jobId: number }> = [];
  readonly invoiceLines: Array<Record<string, unknown>> = [];
  private readonly idempotency = new Map<string, StoredKey>();
  private nextInvoiceId = 1;
  private nextIdempotencyId = 1;
  private transactionTail = Promise.resolve();

  readonly dependencies: InvoiceCreateRouteDependencies = {
    transaction: (callback) => this.transaction(callback),
    findInvoiceById: async (id) => this.invoices.find((invoice) => invoice.id === id),
    enrichInvoices: async (invoices) => invoices.map((invoice) => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      totalAmount: Number(invoice.totalAmount),
      amountPaid: Number(invoice.amountPaid),
      balanceDue: Number(invoice.balanceDue),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      linkedJobs: this.invoiceJobs
        .filter((link) => link.invoiceId === invoice.id)
        .map((link) => {
          const job = this.jobs.find((candidate) => candidate.id === link.jobId);
          return {
            id: link.jobId,
            jobNumber: job?.jobNumber ?? null,
            customerId: job?.customerId ?? null,
            propertyId: job?.propertyId ?? null,
            propertyName: null,
            propertyAddress: null,
            scheduledDate: job?.scheduledDate ?? null,
          };
        }),
      invoiceLines: this.invoiceLines
        .filter((line) => line.invoiceId === invoice.id)
        .map((line) => ({ ...line, createdAt: NOW.toISOString() })),
    })),
  };

  async transaction<T>(callback: (tx: InvoiceCreateTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;

    const invoiceCount = this.invoices.length;
    const invoiceJobCount = this.invoiceJobs.length;
    const invoiceLineCount = this.invoiceLines.length;
    const idempotencySnapshot = new Map(this.idempotency);
    try {
      return await callback({
        createInvoiceAdapter: () => this.createInvoiceAdapter(),
        claimIdempotencyKey: async (input) => this.claimIdempotencyKey(input),
        completeIdempotencyKey: async (id, completion) => this.completeIdempotencyKey(id, completion),
      });
    } catch (error) {
      this.invoices.length = invoiceCount;
      this.invoiceJobs.length = invoiceJobCount;
      this.invoiceLines.length = invoiceLineCount;
      this.idempotency.clear();
      for (const [key, value] of idempotencySnapshot) this.idempotency.set(key, value);
      throw error;
    } finally {
      release();
    }
  }

  private createInvoiceAdapter(): InvoiceCreateAdapter {
    return {
      acquireJobLocks: async () => {},
      findJobsByIds: async (ids) => this.jobs.filter((job) => ids.includes(job.id)),
      insertInvoice: async (values) => {
        const invoice = asStoredInvoice({
          id: this.nextInvoiceId++,
          ...values,
          paidAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        } as InvoiceRow);
        this.invoices.push(invoice);
        return invoice;
      },
      insertInvoiceJob: async (values) => {
        this.invoiceJobs.push(values);
      },
      insertInvoiceLine: async (values) => {
        this.invoiceLines.push(values);
      },
    };
  }

  private async claimIdempotencyKey(
    input: Parameters<InvoiceCreateTransaction["claimIdempotencyKey"]>[0],
  ): Promise<InvoiceCreateIdempotencyClaim> {
    const mapKey = `${input.scope}:${input.operation}:${input.clientKey}`;
    const existing = this.idempotency.get(mapKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash) return { kind: "conflict", record: existing };
      if (existing.status === "completed") return { kind: "replay", record: existing };
      return { kind: "inProgress", record: existing };
    }
    const record = {
      id: this.nextIdempotencyId++,
      scope: input.scope,
      operation: input.operation,
      clientKey: input.clientKey,
      requestHash: input.requestHash,
      status: "in_progress",
      resourceType: null,
      resourceId: null,
      responseStatus: null,
      createdAt: NOW,
      completedAt: null,
      updatedAt: NOW,
    } as StoredKey;
    this.idempotency.set(mapKey, record);
    return { kind: "claimed", record };
  }

  private async completeIdempotencyKey(id: number, completion: InvoiceCreateIdempotencyCompletion): Promise<void> {
    for (const record of this.idempotency.values()) {
      if (record.id === id) {
        record.status = "completed";
        record.resourceType = completion.resourceType;
        record.resourceId = completion.resourceId;
        record.responseStatus = completion.responseStatus;
        record.completedAt = NOW;
        record.updatedAt = NOW;
      }
    }
  }
}

type HttpResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

async function startHarness(harness: InvoiceHttpHarness): Promise<{
  post(path: string, body: unknown, idempotencyKey?: string): Promise<HttpResponse>;
  close(): Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const router = Router();
  router.post("/invoices", createInvoicePostHandler(harness.dependencies));
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

function invoiceBody(unitPrice = "10.00") {
  return {
    customerId: 7,
    jobIds: [42],
    lines: [{ jobId: 42, description: "Window service", quantity: "1", unitPrice }],
  };
}

test("POST /api/invoices allows two distinct invoices to associate the same job", async () => {
  const harness = new InvoiceHttpHarness();
  const http = await startHarness(harness);
  try {
    const first = await http.post("/invoices", invoiceBody("10.00"));
    const second = await http.post("/invoices", invoiceBody("12.00"));

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(harness.invoices.length, 2);
    assert.deepEqual(harness.invoiceJobs, [
      { invoiceId: 1, jobId: 42 },
      { invoiceId: 2, jobId: 42 },
    ]);
  } finally {
    await http.close();
  }
});

test("POST /api/invoices replays the same request and returns enriched data", async () => {
  const harness = new InvoiceHttpHarness();
  const http = await startHarness(harness);
  try {
    const body = invoiceBody();
    const first = await http.post("/invoices", body, "invoice-replay");
    const replay = await http.post("/invoices", body, "invoice-replay");

    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.equal(replay.headers["idempotency-replayed"], "true");
    assert.equal(replay.body.id, first.body.id);
    assert.deepEqual(replay.body.linkedJobs, first.body.linkedJobs);
    assert.deepEqual(replay.body.invoiceLines, first.body.invoiceLines);
    assert.equal(harness.invoices.length, 1);
  } finally {
    await http.close();
  }
});

test("POST /api/invoices rejects a mismatched payload under the same key", async () => {
  const harness = new InvoiceHttpHarness();
  const http = await startHarness(harness);
  try {
    const first = await http.post("/invoices", invoiceBody("10.00"), "invoice-conflict");
    const conflict = await http.post("/invoices", invoiceBody("11.00"), "invoice-conflict");

    assert.equal(first.status, 201);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "This Idempotency-Key was already used with a different request");
    assert.equal(harness.invoices.length, 1);
  } finally {
    await http.close();
  }
});

test("concurrent same-key invoice POSTs create once and replay enriched data", async () => {
  const harness = new InvoiceHttpHarness();
  const http = await startHarness(harness);
  try {
    const body = invoiceBody();
    const [first, concurrent] = await Promise.all([
      http.post("/invoices", body, "invoice-concurrent"),
      http.post("/invoices", body, "invoice-concurrent"),
    ]);

    assert.equal(first.status, 201);
    assert.equal(concurrent.status, 201);
    assert.equal(concurrent.headers["idempotency-replayed"], "true");
    assert.equal(concurrent.body.id, first.body.id);
    assert.deepEqual(concurrent.body.linkedJobs, first.body.linkedJobs);
    assert.deepEqual(concurrent.body.invoiceLines, first.body.invoiceLines);
    assert.equal(harness.invoices.length, 1);
  } finally {
    await http.close();
  }
});

test("legacy single-job POST creates the association and immutable line snapshot", async () => {
  const harness = new InvoiceHttpHarness();
  const http = await startHarness(harness);
  try {
    const response = await http.post("/invoices", {
      customerId: 7,
      jobId: 42,
      lineItems: [{
        description: "Legacy service",
        quantity: "2",
        unitPrice: "12.34",
        discountAmount: "1.00",
        taxAmount: "0.25",
      }],
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.jobId, 42);
    assert.deepEqual(harness.invoiceJobs, [{ invoiceId: 1, jobId: 42 }]);
    assert.deepEqual(harness.invoiceLines.map(({ invoiceId, jobId, description, quantity, unitPrice, discountAmount, taxAmount, lineTotal, sortOrder }) => ({
      invoiceId, jobId, description, quantity, unitPrice, discountAmount, taxAmount, lineTotal, sortOrder,
    })), [{
      invoiceId: 1,
      jobId: 42,
      description: "Legacy service",
      quantity: "2.0",
      unitPrice: "12.34",
      discountAmount: "1.00",
      taxAmount: "0.25",
      lineTotal: "23.93",
      sortOrder: 0,
    }]);
    assert.deepEqual(response.body.invoiceLines.map((line: Record<string, unknown>) => ({
      jobId: line.jobId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxAmount: line.taxAmount,
      lineTotal: line.lineTotal,
    })), [{
      jobId: 42,
      description: "Legacy service",
      quantity: "2.0",
      unitPrice: "12.34",
      discountAmount: "1.00",
      taxAmount: "0.25",
      lineTotal: "23.93",
    }]);
  } finally {
    await http.close();
  }
});