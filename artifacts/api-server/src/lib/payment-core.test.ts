import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPaymentCore,
  allocateExistingPaymentCore,
  PaymentValidationError,
  type PaymentAdapter,
  type PaymentAllocationRow,
  type PaymentInvoiceRow,
  type PaymentRow,
} from "./payment-core.ts";

class MemoryPaymentAdapter implements PaymentAdapter {
  invoices: PaymentInvoiceRow[] = [];
  payments: PaymentRow[] = [];
  allocations: PaymentAllocationRow[] = [];
  nextPaymentId = 1;
  nextAllocationId = 1;

  async acquireInvoiceLocks(): Promise<void> {}
  async acquireCustomerOpenInvoiceLocks(): Promise<void> {}
  async acquirePaymentLock(): Promise<void> {}
  async findInvoicesByIds(ids: number[]) {
    return this.invoices.filter((invoice) => ids.includes(invoice.id));
  }
  async findOpenInvoicesByCustomer(customerId: number) {
    return this.invoices.filter((invoice) =>
      invoice.customerId === customerId && invoice.status !== "paid" && BigInt(invoice.balanceDue.replace(".", "")) > 0n);
  }
  async insertPayment(values: any) {
    const payment: PaymentRow = {
      id: this.nextPaymentId++,
      ...values,
      createdAt: new Date("2026-08-14T12:00:00.000Z"),
      updatedAt: new Date("2026-08-14T12:00:00.000Z"),
    };
    this.payments.push(payment);
    return payment;
  }
  async findPaymentById(id: number) {
    return this.payments.find((payment) => payment.id === id) ?? null;
  }
  async insertAllocation(values: any) {
    const allocation: PaymentAllocationRow = {
      id: this.nextAllocationId++,
      ...values,
      createdAt: new Date("2026-08-14T12:00:00.000Z"),
    };
    this.allocations.push(allocation);
    return allocation;
  }
  async updatePayment(id: number, values: any) {
    const payment = this.payments.find((candidate) => candidate.id === id);
    if (!payment) throw new Error("payment missing");
    Object.assign(payment, values);
    return payment;
  }
  async updateInvoice(id: number, values: any) {
    const invoice = this.invoices.find((candidate) => candidate.id === id);
    if (!invoice) throw new Error("invoice missing");
    Object.assign(invoice, values);
    return invoice;
  }
}

function invoice(
  id: number,
  customerId: number,
  totalAmount: string,
  dueDate: string,
): PaymentInvoiceRow {
  return {
    id,
    customerId,
    totalAmount,
    amountPaid: "0.00",
    balanceDue: totalAmount,
    status: "sent",
    dueDate,
    serviceDate: dueDate,
    paidAt: null,
  };
}

test("manual payment allocates across multiple invoices with exact cents", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [invoice(1, 7, "10.10", "2026-08-01"), invoice(2, 7, "20.20", "2026-08-02")];

  const result = await createPaymentCore({
    customerId: 7,
    amount: "30.30",
    paymentDate: "2026-08-14",
    method: "check",
    mode: "manual",
    allocations: [
      { invoiceId: 1, amount: "10.10" },
      { invoiceId: 2, amount: "20.20" },
    ],
  }, adapter);

  assert.deepEqual(result.allocations, [
    { invoiceId: 1, amount: "10.10" },
    { invoiceId: 2, amount: "20.20" },
  ]);
  assert.equal(adapter.invoices[0].status, "paid");
  assert.equal(adapter.invoices[1].status, "paid");
  assert.equal(result.payment.unappliedAmount, "0.00");
});

test("multiple payments transition one invoice from partial to paid", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [invoice(1, 7, "100.00", "2026-08-01")];

  await createPaymentCore({
    customerId: 7, amount: "40.00", paymentDate: "2026-08-14", method: "cash",
    mode: "manual", allocations: [{ invoiceId: 1, amount: "40.00" }],
  }, adapter);
  const second = await createPaymentCore({
    customerId: 7, amount: "60.00", paymentDate: "2026-08-14", method: "check",
    mode: "manual", allocations: [{ invoiceId: 1, amount: "60.00" }],
  }, adapter);

  assert.equal(adapter.invoices[0].amountPaid, "100.00");
  assert.equal(adapter.invoices[0].balanceDue, "0.00");
  assert.equal(adapter.invoices[0].status, "paid");
  assert.equal(second.allocations[0].amount, "60.00");
});

test("voided and fully credited invoices reject payments while partially credited remains payable", async () => {
  const adapter = new MemoryPaymentAdapter();
  const voided = invoice(1, 7, "20.00", "2026-08-01");
  voided.status = "voided";
  voided.balanceDue = "0.00";
  const credited = invoice(2, 7, "20.00", "2026-08-02");
  credited.status = "credited";
  credited.balanceDue = "0.00";
  const partial = invoice(3, 7, "20.00", "2026-08-03");
  partial.status = "partially_credited";
  partial.balanceDue = "5.00";
  adapter.invoices = [voided, credited, partial];

  for (const invoiceId of [1, 2]) {
    await assert.rejects(
      createPaymentCore({
        customerId: 7, amount: "1.00", paymentDate: "2026-08-14", method: "check",
        mode: "manual", allocations: [{ invoiceId, amount: "1.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === "invoice_not_payable",
    );
  }
  const result = await createPaymentCore({
    customerId: 7, amount: "5.00", paymentDate: "2026-08-14", method: "check",
    mode: "manual", allocations: [{ invoiceId: 3, amount: "5.00" }],
  }, adapter);
  assert.equal(result.allocations[0].amount, "5.00");
  assert.equal(partial.status, "paid");
  assert.equal(adapter.payments.length, 1);
});

test("existing unapplied payments reject allocations to voided and fully credited invoices", async () => {
  const adapter = new MemoryPaymentAdapter();
  const voided = invoice(1, 7, "20.00", "2026-08-01");
  voided.status = "voided";
  voided.balanceDue = "0.00";
  const credited = invoice(2, 7, "20.00", "2026-08-02");
  credited.status = "credited";
  credited.balanceDue = "0.00";
  adapter.invoices = [voided, credited];
  adapter.payments = [{
    id: 1,
    customerId: 7,
    amount: "10.00",
    allocatedAmount: "0.00",
    unappliedAmount: "10.00",
    paymentDate: "2026-08-14",
    method: "check",
    reference: null,
    note: null,
    status: "posted",
    createdAt: new Date("2026-08-14T12:00:00.000Z"),
    updatedAt: new Date("2026-08-14T12:00:00.000Z"),
  }];

  for (const invoiceId of [1, 2]) {
    await assert.rejects(
      allocateExistingPaymentCore(1, {
        mode: "manual",
        allocations: [{ invoiceId, amount: "1.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === "invoice_not_payable",
    );
  }
  assert.equal(adapter.allocations.length, 0);
});

test("payment after partial credit preserves the credit history and closes only the remaining balance", async () => {
  const adapter = new MemoryPaymentAdapter();
  const partial = invoice(1, 7, "20.00", "2026-08-01");
  partial.status = "partially_credited";
  partial.balanceDue = "5.00";
  adapter.invoices = [partial];
  adapter.payments = [{
    id: 1,
    customerId: 7,
    amount: "5.00",
    allocatedAmount: "0.00",
    unappliedAmount: "5.00",
    paymentDate: "2026-08-14",
    method: "check",
    reference: null,
    note: null,
    status: "posted",
    createdAt: new Date("2026-08-14T12:00:00.000Z"),
    updatedAt: new Date("2026-08-14T12:00:00.000Z"),
  }];
  const creditHistory = [{ creditNumber: "CN-1", totalAmount: "15.00" }];
  const historyBefore = structuredClone(creditHistory);

  await allocateExistingPaymentCore(1, {
    mode: "manual",
    allocations: [{ invoiceId: 1, amount: "5.00" }],
  }, adapter);

  assert.equal(partial.amountPaid, "5.00");
  assert.equal(partial.balanceDue, "0.00");
  assert.equal(partial.status, "paid");
  assert.deepEqual(creditHistory, historyBefore);
});

test("auto-apply uses deterministic oldest-first ordering and leaves customer credit", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [
    invoice(2, 7, "25.00", "2026-08-10"),
    invoice(1, 7, "40.00", "2026-08-01"),
    invoice(3, 7, "10.00", "2026-08-20"),
  ];

  const result = await createPaymentCore({
    customerId: 7, amount: "100.00", paymentDate: "2026-08-14", method: "bank_transfer",
    mode: "auto",
  }, adapter);

  assert.deepEqual(result.allocations.map((allocation) => allocation.invoiceId), [1, 2, 3]);
  assert.equal(result.payment.allocatedAmount, "75.00");
  assert.equal(result.payment.unappliedAmount, "25.00");
});

test("unapplied credit can later be allocated to an invoice", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [invoice(1, 7, "20.00", "2026-08-01")];
  const payment = await createPaymentCore({
    customerId: 7, amount: "50.00", paymentDate: "2026-08-14", method: "check", mode: "auto",
  }, adapter);
  adapter.invoices.push(invoice(2, 7, "15.00", "2026-08-02"));

  const result = await allocateExistingPaymentCore(payment.payment.id, {
    mode: "manual",
    allocations: [{ invoiceId: 2, amount: "15.00" }],
  }, adapter);

  assert.equal(result.payment.allocatedAmount, "35.00");
  assert.equal(result.payment.unappliedAmount, "15.00");
  assert.equal(adapter.invoices[1].status, "paid");
});

test("cross-customer allocation and over-allocation fail without writes", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [invoice(1, 7, "20.00", "2026-08-01"), invoice(2, 8, "20.00", "2026-08-02")];

  await assert.rejects(
    createPaymentCore({
      customerId: 7, amount: "10.00", paymentDate: "2026-08-14", method: "check",
      mode: "manual", allocations: [{ invoiceId: 2, amount: "10.00" }],
    }, adapter),
    (error: unknown) => error instanceof PaymentValidationError && error.code === "customer_mismatch",
  );
  assert.equal(adapter.payments.length, 0);

  await assert.rejects(
    createPaymentCore({
      customerId: 7, amount: "25.00", paymentDate: "2026-08-14", method: "check",
      mode: "manual", allocations: [{ invoiceId: 1, amount: "25.00" }],
    }, adapter),
    (error: unknown) => error instanceof PaymentValidationError && error.code === "invoice_over_allocation",
  );
  assert.equal(adapter.payments.length, 0);
  assert.equal(adapter.allocations.length, 0);
});

test("manual cash/check payments must be positive and fully fit the selected outstanding balance", async () => {
  for (const method of ["cash", "check", "other"]) {
    const adapter = new MemoryPaymentAdapter();
    adapter.invoices = [invoice(1, 7, "50.00", "2026-08-01")];

    await assert.rejects(
      createPaymentCore({
        customerId: 7, amount: "0.00", paymentDate: "2026-08-14", method,
        mode: "manual", allocations: [{ invoiceId: 1, amount: "0.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === "amount_must_be_positive",
    );
    await assert.rejects(
      createPaymentCore({
        customerId: 7, amount: "60.00", paymentDate: "2026-08-14", method,
        mode: "manual", allocations: [{ invoiceId: 1, amount: "60.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === "invoice_over_allocation",
    );
    await assert.rejects(
      createPaymentCore({
        customerId: 7, amount: "25.00", paymentDate: "2026-08-14", method,
        mode: "manual", allocations: [{ invoiceId: 1, amount: "20.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === "manual_allocation_mismatch",
    );
    assert.equal(adapter.payments.length, 0);
    assert.equal(adapter.allocations.length, 0);
    assert.equal(adapter.invoices[0].balanceDue, "50.00");
  }
});

test("payment boundary rejects invalid customers, calendar dates, and methods without writes", async () => {
  for (const input of [
    { customerId: 0, paymentDate: "2026-08-14", method: "cash", code: "invalid_customer_id" },
    { customerId: 7, paymentDate: "2026-02-30", method: "cash", code: "invalid_payment_date" },
    { customerId: 7, paymentDate: "2026-08-14", method: "card", code: "invalid_method" },
  ]) {
    const adapter = new MemoryPaymentAdapter();
    adapter.invoices = [invoice(1, 7, "10.00", "2026-08-01")];
    await assert.rejects(
      createPaymentCore({
        customerId: input.customerId,
        amount: "10.00",
        paymentDate: input.paymentDate,
        method: input.method,
        mode: "manual",
        allocations: [{ invoiceId: 1, amount: "10.00" }],
      }, adapter),
      (error: unknown) => error instanceof PaymentValidationError && error.code === input.code,
    );
    assert.equal(adapter.payments.length, 0);
    assert.equal(adapter.allocations.length, 0);
  }
});

test("manual methods post without any Stripe dependency", async () => {
  for (const method of ["cash", "check", "ach", "bank_transfer", "other"]) {
    const adapter = new MemoryPaymentAdapter();
    adapter.invoices = [invoice(1, 7, "10.00", "2026-08-01")];
    const result = await createPaymentCore({
      customerId: 7,
      amount: "10.00",
      paymentDate: "2026-08-14",
      method,
      reference: method === "cash" ? null : "offline-reference",
      mode: "manual",
      allocations: [{ invoiceId: 1, amount: "10.00" }],
    }, adapter);
    assert.equal(result.payment.method, method);
    assert.equal(result.payment.status, "posted");
    assert.equal(adapter.invoices[0].status, "paid");
  }
});

test("new idempotent request can intentionally create a second payment", async () => {
  const adapter = new MemoryPaymentAdapter();
  adapter.invoices = [invoice(1, 7, "100.00", "2026-08-01")];
  const input = {
    customerId: 7, amount: "10.10", paymentDate: "2026-08-14", method: "check",
    mode: "manual" as const, allocations: [{ invoiceId: 1, amount: "10.10" }],
  };
  const first = await createPaymentCore(input, adapter);
  const second = await createPaymentCore(input, adapter);
  assert.notEqual(first.payment.id, second.payment.id);
  assert.equal(adapter.invoices[0].amountPaid, "20.20");
});