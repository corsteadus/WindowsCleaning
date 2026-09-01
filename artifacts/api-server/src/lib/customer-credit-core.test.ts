import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCustomerCreditCore,
  createCustomerCreditRefundCore,
  CustomerCreditValidationError,
  type CustomerCreditAdapter,
  type CustomerCreditInvoiceRow,
  type CustomerCreditPaymentRow,
  type CustomerCreditSourceRow,
} from "./customer-credit-core.ts";

function invoice(id: number, balanceDue: string, customerId = 7): CustomerCreditInvoiceRow {
  return {
    id, customerId, totalAmount: balanceDue, amountPaid: "0.00", balanceDue,
    status: "sent", dueDate: `2026-08-${String(id).padStart(2, "0")}`,
    serviceDate: null, paidAt: null,
  };
}

function makeFixture() {
  const sources: CustomerCreditSourceRow[] = [
    { sourceKey: "credit_note:11", sourceType: "credit_note", sourceId: 11, customerId: 7, originalAmount: "15.00", availableAmount: "15.00", createdAt: "2026-08-01T00:00:00.000Z" },
    { sourceKey: "payment:22", sourceType: "payment", sourceId: 22, customerId: 7, originalAmount: "30.00", availableAmount: "30.00", createdAt: "2026-08-02T00:00:00.000Z" },
  ];
  const invoices = new Map<number, CustomerCreditInvoiceRow>([
    [1, invoice(1, "20.00")],
    [2, invoice(2, "10.00")],
  ]);
  const payments = new Map<number, CustomerCreditPaymentRow>([
    [22, { id: 22, customerId: 7, amount: "30.00", allocatedAmount: "0.00", unappliedAmount: "30.00" }],
  ]);
  const applications: Array<{ sourceKey: string; invoiceId: number; amount: string }> = [];
  const refunds: Array<{ id: number; amount: string }> = [];
  let nextRefundId = 90;
  const adapter: CustomerCreditAdapter = {
    acquireCustomerLock: async () => {},
    acquireSourceLocks: async () => {},
    acquireInvoiceLocks: async () => {},
    findSources: async () => sources.map((source) => ({ ...source })),
    findInvoicesByIds: async (ids) => ids.map((id) => invoices.get(id)).filter(Boolean) as CustomerCreditInvoiceRow[],
    findOpenInvoicesByCustomer: async (customerId) => [...invoices.values()].filter((row) => row.customerId === customerId && row.balanceDue !== "0.00"),
    findPaymentById: async (id) => payments.get(id) ?? null,
    insertApplication: async (values) => {
      applications.push(values);
      const source = sources.find((row) => row.sourceKey === values.sourceKey)!;
      if (source.sourceType === "credit_note") {
        source.availableAmount = (Number(source.availableAmount) - Number(values.amount)).toFixed(2);
      }
      return { id: applications.length };
    },
    updateInvoice: async (id, values) => {
      const updated = { ...invoices.get(id)!, ...values };
      invoices.set(id, updated);
      return updated;
    },
    updatePayment: async (id, values) => {
      const updated = { ...payments.get(id)!, ...values };
      payments.set(id, updated);
      const source = sources.find((row) => row.sourceKey === `payment:${id}`);
      if (source) source.availableAmount = updated.unappliedAmount;
      return updated;
    },
    insertPaymentAllocation: async () => ({ id: applications.length + 1 }),
    insertRefund: async (values) => {
      const id = nextRefundId++;
      refunds.push({ id, amount: values.amount });
      return { id };
    },
    insertRefundAllocation: async (values) => {
      const source = sources.find((row) => row.sourceKey === values.sourceKey)!;
      if (source.sourceType === "credit_note") {
        source.availableAmount = (Number(source.availableAmount) - Number(values.amount)).toFixed(2);
      }
      return { id: values.refundId };
    },
  };
  return { adapter, sources, invoices, payments, applications, refunds };
}

test("oldest-first application spans sources and invoices with exact cents", async () => {
  const fixture = makeFixture();
  const result = await applyCustomerCreditCore({
    customerId: 7, mode: "oldest", amount: "30.00",
  }, fixture.adapter);
  assert.deepEqual(result.applications.map((row) => [row.sourceKey, row.invoiceId, row.amount]), [
    ["credit_note:11", 1, "15.00"],
    ["payment:22", 1, "5.00"],
    ["payment:22", 2, "10.00"],
  ]);
  assert.equal(fixture.invoices.get(1)?.status, "paid");
  assert.equal(fixture.invoices.get(2)?.balanceDue, "0.00");
  assert.equal(fixture.payments.get(22)?.unappliedAmount, "15.00");
});

test("manual application rejects cross-customer and over-invoice requests", async () => {
  const fixture = makeFixture();
  fixture.invoices.set(99, invoice(99, "10.00", 99));
  await assert.rejects(
    applyCustomerCreditCore({
      customerId: 7, mode: "manual",
      allocations: [{ sourceKey: "payment:22", invoiceId: 99, amount: "1.00" }],
    }, fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "customer_mismatch",
  );
  await assert.rejects(
    applyCustomerCreditCore({
      customerId: 7, mode: "manual",
      allocations: [{ sourceKey: "credit_note:11", invoiceId: 1, amount: "20.00" }],
    }, fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_application",
  );
});

test("manual application supports mixed origins and preserves exact invoice/payment balances", async () => {
  const fixture = makeFixture();
  const result = await applyCustomerCreditCore({
    customerId: 7,
    mode: "manual",
    allocations: [
      { sourceKey: "payment:22", invoiceId: 1, amount: "4.32" },
      { sourceKey: "credit_note:11", invoiceId: 2, amount: "2.11" },
    ],
  }, fixture.adapter);

  assert.deepEqual(result.applications.map((row) => [row.sourceKey, row.invoiceId, row.amount, row.origin]), [
    ["payment:22", 1, "4.32", "payment"],
    ["credit_note:11", 2, "2.11", "credit_note"],
  ]);
  assert.deepEqual(fixture.invoices.get(1), {
    ...invoice(1, "20.00"),
    status: "partial",
    amountPaid: "4.32",
    balanceDue: "15.68",
    paidAt: null,
  });
  assert.deepEqual(fixture.invoices.get(2), {
    ...invoice(2, "10.00"),
    status: "partially_credited",
    amountPaid: "0.00",
    balanceDue: "7.89",
    paidAt: null,
  });
  assert.equal(fixture.payments.get(22)?.allocatedAmount, "4.32");
  assert.equal(fixture.payments.get(22)?.unappliedAmount, "25.68");
  assert.equal(fixture.sources.find((source) => source.sourceKey === "payment:22")?.availableAmount, "25.68");
  assert.equal(fixture.sources.find((source) => source.sourceKey === "credit_note:11")?.availableAmount, "12.89");
});

test("closed, voided, and fully credited invoices reject applications atomically", async () => {
  for (const [status, balanceDue, expectedCode] of [
    ["paid", "0.00", "invoice_over_application"],
    ["voided", "0.00", "invoice_not_creditable"],
    ["credited", "0.00", "invoice_not_creditable"],
  ] as const) {
    const fixture = makeFixture();
    fixture.invoices.set(1, { ...invoice(1, balanceDue), status });
    const beforeInvoices = structuredClone([...fixture.invoices.entries()]);
    const beforeSources = structuredClone(fixture.sources);
    await assert.rejects(
      applyCustomerCreditCore({
        customerId: 7,
        mode: "manual",
        allocations: [{ sourceKey: "credit_note:11", invoiceId: 1, amount: "1.00" }],
      }, fixture.adapter),
      (error: unknown) => error instanceof CustomerCreditValidationError && error.code === expectedCode,
    );
    assert.deepEqual([...fixture.invoices.entries()], beforeInvoices);
    assert.deepEqual(fixture.sources, beforeSources);
    assert.equal(fixture.applications.length, 0);
  }
});

test("credit-note-origin refunds consume only available credit", async () => {
  const fixture = makeFixture();
  const result = await createCustomerCreditRefundCore({
    customerId: 7, amount: "12.34", refundDate: "2026-08-14", method: "check", reason: "Customer request",
  }, "REF-7-1", fixture.adapter);
  assert.equal(result.amount, "12.34");
  assert.deepEqual(result.allocations, [{ sourceKey: "credit_note:11", amount: "12.34", origin: "credit_note" }]);
  assert.equal(fixture.sources[0].availableAmount, "2.66");
  await assert.rejects(
    createCustomerCreditRefundCore({
      customerId: 7, amount: "100.00", refundDate: "2026-08-14", method: "check", reason: "Too much",
    }, "REF-7-2", fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_refund",
  );
});

test("manual refunds can consume payment-origin credit and preserve its allocated cash", async () => {
  const fixture = makeFixture();
  const result = await createCustomerCreditRefundCore({
    customerId: 7,
    amount: "12.34",
    refundDate: "2026-08-14",
    method: "check",
    reason: "Payment-origin refund",
    mode: "manual",
    allocations: [{ sourceKey: "payment:22", amount: "12.34" }],
  }, "REF-7-3", fixture.adapter);

  assert.deepEqual(result.allocations, [{ sourceKey: "payment:22", amount: "12.34", origin: "payment" }]);
  assert.equal(fixture.payments.get(22)?.allocatedAmount, "0.00");
  assert.equal(fixture.payments.get(22)?.unappliedAmount, "17.66");
  assert.equal(fixture.sources.find((source) => source.sourceKey === "payment:22")?.availableAmount, "17.66");
  assert.equal(fixture.refunds.length, 1);
});

test("payment-origin credit cannot be applied or refunded twice", async () => {
  const fixture = makeFixture();
  await applyCustomerCreditCore({
    customerId: 7,
    mode: "manual",
    allocations: [{ sourceKey: "payment:22", invoiceId: 1, amount: "20.00" }],
  }, fixture.adapter);

  await assert.rejects(
    applyCustomerCreditCore({
      customerId: 7,
      mode: "manual",
      allocations: [{ sourceKey: "payment:22", invoiceId: 2, amount: "11.00" }],
    }, fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_application",
  );
  await assert.rejects(
    createCustomerCreditRefundCore({
      customerId: 7,
      amount: "11.00",
      refundDate: "2026-08-14",
      method: "check",
      reason: "Too much after application",
      mode: "manual",
      allocations: [{ sourceKey: "payment:22", amount: "11.00" }],
    }, "REF-7-4", fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_refund",
  );
  assert.equal(fixture.payments.get(22)?.unappliedAmount, "10.00");
  assert.equal(fixture.refunds.length, 0);
});

test("credit-note-origin credit cannot be applied or refunded twice", async () => {
  const fixture = makeFixture();
  await applyCustomerCreditCore({
    customerId: 7,
    mode: "manual",
    allocations: [{ sourceKey: "credit_note:11", invoiceId: 1, amount: "10.00" }],
  }, fixture.adapter);

  await assert.rejects(
    applyCustomerCreditCore({
      customerId: 7,
      mode: "manual",
      allocations: [{ sourceKey: "credit_note:11", invoiceId: 2, amount: "6.00" }],
    }, fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_application",
  );
  await assert.rejects(
    createCustomerCreditRefundCore({
      customerId: 7,
      amount: "6.00",
      refundDate: "2026-08-14",
      method: "check",
      reason: "Too much after application",
      mode: "manual",
      allocations: [{ sourceKey: "credit_note:11", amount: "6.00" }],
    }, "REF-7-5", fixture.adapter),
    (error: unknown) => error instanceof CustomerCreditValidationError && error.code === "credit_over_refund",
  );
  assert.equal(fixture.sources.find((source) => source.sourceKey === "credit_note:11")?.availableAmount, "5.00");
  assert.equal(fixture.refunds.length, 0);
});

test("combined cash, credit-note, customer-credit, and refund movements preserve invoice cash integrity", async () => {
  const fixture = makeFixture();
  const combined = { ...invoice(1, "60.00"), totalAmount: "100.00", amountPaid: "40.00", status: "partial" };
  fixture.invoices.set(1, combined);

  await applyCustomerCreditCore({
    customerId: 7,
    mode: "manual",
    allocations: [
      { sourceKey: "credit_note:11", invoiceId: 1, amount: "15.00" },
      { sourceKey: "payment:22", invoiceId: 1, amount: "10.00" },
    ],
  }, fixture.adapter);
  assert.equal(fixture.invoices.get(1)?.amountPaid, "50.00");
  assert.equal(fixture.invoices.get(1)?.balanceDue, "35.00");
  assert.equal(fixture.invoices.get(1)?.status, "partial");

  await createCustomerCreditRefundCore({
    customerId: 7,
    amount: "5.00",
    refundDate: "2026-08-14",
    method: "check",
    reason: "Return unused payment credit",
    mode: "manual",
    allocations: [{ sourceKey: "payment:22", amount: "5.00" }],
  }, "REF-7-6", fixture.adapter);
  assert.equal(fixture.invoices.get(1)?.amountPaid, "50.00");
  assert.equal(fixture.invoices.get(1)?.balanceDue, "35.00");
  assert.equal(fixture.invoices.get(1)?.status, "partial");
  assert.equal(fixture.payments.get(22)?.allocatedAmount, "10.00");
  assert.equal(fixture.payments.get(22)?.unappliedAmount, "15.00");
});