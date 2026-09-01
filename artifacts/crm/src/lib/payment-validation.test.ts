import assert from "node:assert/strict";
import test from "node:test";
import { validateInvoicePayment } from "./payment-validation.ts";

const valid = {
  customerId: 7,
  invoiceId: 11,
  amount: "25.00",
  outstanding: "50.00",
  paymentDate: "2026-08-14",
  method: "cash",
};

test("manual invoice payment validation accepts partial/full and rejects invalid or excess input", () => {
  assert.equal(validateInvoicePayment(valid), null);
  assert.equal(validateInvoicePayment({ ...valid, amount: "50.00" }), null);
  assert.match(validateInvoicePayment({ ...valid, amount: "50.01" })!, /outstanding/);
  assert.match(validateInvoicePayment({ ...valid, amount: "0" })!, /greater than zero/);
  assert.match(validateInvoicePayment({ ...valid, paymentDate: "2026-02-30" })!, /valid payment date/);
  assert.match(validateInvoicePayment({ ...valid, method: "card" })!, /valid payment method/);
  assert.match(validateInvoicePayment({ ...valid, customerId: 0 })!, /valid customer/);
  assert.match(validateInvoicePayment({ ...valid, invoiceId: 0 })!, /valid invoice/);
});