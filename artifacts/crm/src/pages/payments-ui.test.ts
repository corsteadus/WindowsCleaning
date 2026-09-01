import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("payments UI uses live API state and canonical allocation mutations", async () => {
  const [payments, invoice] = await Promise.all([
    readFile(new URL("./Payments.tsx", import.meta.url), "utf8"),
    readFile(new URL("./InvoiceDetail.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(payments, /Stripe not connected/);
  assert.doesNotMatch(payments, /Sandbox payment/);
  assert.match(payments, /recordIdempotencyKey\.current \?\?= createIdempotencyKey\(\)/);
  assert.match(payments, /recordPaymentMutation\.isPending \|\| !!recordPaymentValidationError/);
  assert.match(payments, /<option value="cash">Cash<\/option>/);
  assert.match(payments, /<option value="check">Check<\/option>/);
  assert.match(payments, /<option value="other">Other<\/option>/);
  assert.doesNotMatch(payments, /<option value="card">Card \(record only\)<\/option>/);

  assert.match(invoice, /return createPayment\(\{/);
  assert.match(invoice, /allocations: \[\{ invoiceId, amount: String\(invoice\.balanceDue\) \}\]/);
  assert.match(invoice, /if \(!\(Number\(invoice\.balanceDue\) > 0\)\)/);
  assert.match(invoice, /idempotencyRequest\(createIdempotencyKey\(\)\)/);
  assert.match(invoice, /useGetFinancialCapabilities/);
  assert.match(invoice, /canRecord=\{canRecordPayment\}/);
  assert.match(invoice, /disabled=\{!canRecord \|\| record\.isPending \|\| !!validationError\}/);
  assert.match(payments, /disabled=\{!canRecordPayment \|\| recordPaymentMutation\.isPending \|\| !!recordPaymentValidationError\}/);
  assert.match(payments, /useGeneratePaymentLink/);
  assert.match(invoice, /Generate Payment Link/);
});