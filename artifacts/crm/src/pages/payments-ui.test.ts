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
  assert.match(payments, /PAYMENT_METHOD_OPTIONS\.map\(\(option\) => \(/,
    "the record-payment methods come from the shared list, not from hand-written options");
  assert.doesNotMatch(payments, /<option value="(cash|check|other|card)">/,
    "a method written by hand here would drift from what the API accepts");
  assert.match(invoice, /PAYMENT_METHOD_OPTIONS\.map\(\(option\) => \(/,
    "recording a payment on an invoice offers the same methods");

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