import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  invoicesTable,
  jobsTable,
  paymentAllocationsTable,
  paymentsTable,
  customerCreditSourcesTable,
} from "@workspace/db";
import type {
  PaymentAdapter,
  PaymentAllocationRow,
  PaymentInvoiceRow,
  PaymentRow,
} from "./payment-core.js";

export type PaymentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function invoiceSelection() {
  return {
    id: invoicesTable.id,
    customerId: invoicesTable.customerId,
    totalAmount: invoicesTable.totalAmount,
    amountPaid: invoicesTable.amountPaid,
    balanceDue: invoicesTable.balanceDue,
    status: invoicesTable.status,
    dueDate: invoicesTable.dueDate,
    paidAt: invoicesTable.paidAt,
    serviceDate: jobsTable.scheduledDate,
  };
}

export function createPaymentAdapter(tx: PaymentTransaction): PaymentAdapter {
  return {
    acquireInvoiceLocks: async (invoiceIds) => {
      if (!invoiceIds.length) return;
      const ids = sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`
        SELECT id
        FROM invoices
        WHERE id IN (${ids})
        ORDER BY id
        FOR UPDATE
      `);
    },
    acquireCustomerOpenInvoiceLocks: async (customerId) => {
      await tx.execute(sql`
        SELECT id
        FROM invoices
        WHERE customer_id = ${customerId}
          AND status <> 'paid'
          AND status <> 'voided'
          AND status <> 'credited'
          AND balance_due::numeric > 0
        ORDER BY id
        FOR UPDATE
      `);
    },
    acquirePaymentLock: async (paymentId) => {
      await tx.execute(sql`
        SELECT id
        FROM payments
        WHERE id = ${paymentId}
        FOR UPDATE
      `);
    },
    findInvoicesByIds: async (invoiceIds): Promise<PaymentInvoiceRow[]> => {
      if (!invoiceIds.length) return [];
      return tx
        .select(invoiceSelection())
        .from(invoicesTable)
        .leftJoin(jobsTable, eq(jobsTable.id, invoicesTable.jobId))
        .where(inArray(invoicesTable.id, invoiceIds)) as unknown as Promise<PaymentInvoiceRow[]>;
    },
    findOpenInvoicesByCustomer: async (customerId): Promise<PaymentInvoiceRow[]> => {
      return tx
        .select(invoiceSelection())
        .from(invoicesTable)
        .leftJoin(jobsTable, eq(jobsTable.id, invoicesTable.jobId))
        .where(and(
          eq(invoicesTable.customerId, customerId),
          ne(invoicesTable.status, "paid"),
          gt(invoicesTable.balanceDue, "0"),
        ))
        .orderBy(asc(invoicesTable.id)) as unknown as Promise<PaymentInvoiceRow[]>;
    },
    insertPayment: async (values): Promise<PaymentRow> => {
      const [payment] = await tx.insert(paymentsTable).values(values).returning();
      return payment as PaymentRow;
    },
    findPaymentById: async (paymentId): Promise<PaymentRow | null> => {
      const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      return (payment as PaymentRow | undefined) ?? null;
    },
    insertAllocation: async (values): Promise<PaymentAllocationRow> => {
      const [allocation] = await tx.insert(paymentAllocationsTable).values(values).returning();
      return allocation as PaymentAllocationRow;
    },
    updatePayment: async (paymentId, values): Promise<PaymentRow> => {
      const [payment] = await tx.update(paymentsTable).set(values).where(eq(paymentsTable.id, paymentId)).returning();
      return payment as PaymentRow;
    },
    syncUnappliedCreditSource: async (payment) => {
      if (Number(payment.unappliedAmount) <= 0) return;
      await tx.insert(customerCreditSourcesTable).values({
        sourceKey: `payment:${payment.id}`,
        sourceType: "payment",
        sourceId: payment.id,
        customerId: payment.customerId,
        originalAmount: payment.amount,
      }).onConflictDoNothing({ target: customerCreditSourcesTable.sourceKey });
    },
    updateInvoice: async (invoiceId, values): Promise<PaymentInvoiceRow> => {
      const [invoice] = await tx
        .update(invoicesTable)
        .set(values)
        .where(eq(invoicesTable.id, invoiceId))
        .returning();
      if (!invoice) throw new Error(`Invoice #${invoiceId} disappeared during payment allocation`);
      const [job] = invoice.jobId
        ? await tx.select({ scheduledDate: jobsTable.scheduledDate }).from(jobsTable).where(eq(jobsTable.id, invoice.jobId))
        : [];
      return {
        ...invoice,
        serviceDate: job?.scheduledDate ?? null,
      } as unknown as PaymentInvoiceRow;
    },
  };
}

export async function assertPaymentCustomer(
  tx: PaymentTransaction,
  customerId: number,
): Promise<void> {
  const [customer] = await tx
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Customer not found");
}