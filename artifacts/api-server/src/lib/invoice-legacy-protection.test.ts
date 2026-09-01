import assert from "node:assert/strict";
import { test } from "node:test";
import express, { Router } from "express";
import { createServer, request as httpRequest } from "node:http";
import { correctedInvoiceDeleteError, correctedInvoicePatchError } from "./invoice-legacy-protection.ts";

function request(app: ReturnType<typeof express>, path: string, method: "PATCH" | "DELETE", body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const payload = JSON.stringify(body ?? {});
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: (address as any).port,
        path,
        method,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        });
      });
      req.on("error", (error) => { server.close(); reject(error); });
      req.write(payload);
      req.end();
    });
  });
}

function appFor(status: string) {
  const app = express();
  app.use(express.json());
  const router = Router();
  router.patch("/invoices/:id", (req, res) => {
    const error = correctedInvoicePatchError(status, req.body);
    if (error) return res.status(400).json(error);
    return res.json({ ok: true });
  });
  router.delete("/invoices/:id", (_req, res) => {
    const error = correctedInvoiceDeleteError(status);
    if (error) return res.status(400).json(error);
    return res.sendStatus(204);
  });
  app.use(router);
  return app;
}

test("corrected-invoice PATCH rejects accounting edits while allowing metadata-only edits", async () => {
  const corrected = appFor("partially_credited");
  const rejected = await request(corrected, "/invoices/1", "PATCH", { totalAmount: "999.00" });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, "invoice_immutable");
  const allowed = await request(corrected, "/invoices/1", "PATCH", { notes: "Internal note" });
  assert.equal(allowed.status, 200);
});

test("ordinary invoices cannot PATCH into a corrected status", () => {
  const error = correctedInvoicePatchError("sent", { status: "voided" });
  assert.equal(error?.code, "invoice_immutable");
});

test("corrected-invoice DELETE rejects corrected statuses and permits legacy statuses", async () => {
  const rejected = await request(appFor("credited"), "/invoices/1", "DELETE");
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, "invoice_immutable");
  const allowed = await request(appFor("sent"), "/invoices/1", "DELETE");
  assert.equal(allowed.status, 204);
});