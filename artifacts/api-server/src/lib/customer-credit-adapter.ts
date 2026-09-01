import { and, asc, eq, gt, inArray, not, sql } from "drizzle-orm";
import {
  customersTable,
  customerCreditApplicationsTable,
  customerCreditRefundAllocationsTable,
  customerCreditRefundsTable,
  customerCreditSourcesTable,
  invoicesTable,
  jobsTable,
  paymentAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import type {
  CustomerCreditAdapter,
  CustomerCreditInvoiceRow,
  CustomerCreditPaymentRow,
  CustomerCreditSourceRow,
} from "./customer-credit-core.js";

export type CustomerCreditTransaction = Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];

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

function sourceType(value: string): "credit_note" | "payment" {
  return value === "payment" ? "payment" : "credit_note";
}

export function createCustomerCreditAdapter(tx: CustomerCreditTransaction): CustomerCreditAdapter {
  return {
    acquireCustomerLock: async (customerId) => {
      await tx.execute(sql`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`);
    },
    acquireSourceLocks: async (sourceKeys) => {
      const keys = [...new Set(sourceKeys)].sort();
      if (!keys.length) return;
      await tx.execute(sql`
        SELECT source_key
        FROM customer_credit_sources
        WHERE source_key IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
        ORDER BY source_key
        FOR UPDATE
      `);
      const paymentIds = keys
        .filter((key) => key.startsWith("payment:"))
        .map((key) => Number(key.slice("payment:".length)))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (paymentIds.length) {
        await tx.execute(sql`
          SELECT id
          FROM payments
          WHERE id IN (${sql.join(paymentIds.map((id) => sql`${id}`), sql`, `)})
          ORDER BY id
          FOR UPDATE
        `);
      }
    },
    acquireInvoiceLocks: async (invoiceIds) => {
      if (!invoiceIds.length) return;
      await tx.execute(sql`
        SELECT id
        FROM invoices
        WHERE id IN (${sql.join(invoiceIds.map((id) => sql`${id}`), sql`, `)})
        ORDER BY id
        FOR UPDATE
      `);
    },
    findSources: async (customerId): Promise<CustomerCreditSourceRow[]> => {
      const persisted = await tx
        .select()
        .from(customerCreditSourcesTable)
        .where(eq(customerCreditSourcesTable.customerId, customerId))
        .orderBy(asc(customerCreditSourcesTable.createdAt), asc(customerCreditSourcesTable.id));
      const applications = await tx
        .select({
          sourceKey: customerCreditApplicationsTable.sourceKey,
          amount: customerCreditApplicationsTable.amount,
        })
        .from(customerCreditApplicationsTable)
        .where(eq(customerCreditApplicationsTable.customerId, customerId));
      const refunds = await tx
        .select({
          sourceKey: customerCreditRefundAllocationsTable.sourceKey,
          amount: customerCreditRefundAllocationsTable.amount,
        })
        .from(customerCreditRefundAllocationsTable)
        .innerJoin(customerCreditRefundsTable, eq(customerCreditRefundsTable.id, customerCreditRefundAllocationsTable.refundId))
        .where(eq(customerCreditRefundsTable.customerId, customerId));
      const usedBySource = new Map<string, number>();
      for (const row of [...applications, ...refunds]) {
        usedBySource.set(row.sourceKey, (usedBySource.get(row.sourceKey) ?? 0) + Number(row.amount));
      }
      const paymentIds = persisted.filter((source) => source.sourceType === "payment").map((source) => source.sourceId);
      const persistedKeys = new Set(persisted.map((source) => source.sourceKey));
      const payments = await tx
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.customerId, customerId));
      const rows: CustomerCreditSourceRow[] = [];
      for (const source of persisted) {
        const payment = source.sourceType === "payment" ? payments.find((candidate) => candidate.id === source.sourceId) : null;
        const available = source.sourceType === "payment"
          ? Number(payment?.unappliedAmount ?? 0)
          : Math.max(0, Number(source.originalAmount) - (usedBySource.get(source.sourceKey) ?? 0));
        rows.push({
          sourceKey: source.sourceKey,
          sourceType: sourceType(source.sourceType),
          sourceId: source.sourceId,
          customerId: source.customerId,
          originalAmount: source.originalAmount,
          availableAmount: available.toFixed(2),
          createdAt: source.createdAt,
        });
      }
      for (const payment of payments) {
        const sourceKey = `payment:${payment.id}`;
        if (persistedKeys.has(sourceKey) || Number(payment.unappliedAmount) <= 0) continue;
        rows.push({
          sourceKey,
          sourceType: "payment",
          sourceId: payment.id,
          customerId,
          originalAmount: payment.unappliedAmount,
          availableAmount: payment.unappliedAmount,
          createdAt: payment.createdAt,
        });
      }
      return rows;
    },
    findInvoicesByIds: async (invoiceIds): Promise<CustomerCreditInvoiceRow[]> => {
      if (!invoiceIds.length) return [];
      return tx.select(invoiceSelection()).from(invoicesTable)
        .leftJoin(jobsTable, eq(jobsTable.id, invoicesTable.jobId))
        .where(inArray(invoicesTable.id, invoiceIds)) as unknown as Promise<CustomerCreditInvoiceRow[]>;
    },
    findOpenInvoicesByCustomer: async (customerId): Promise<CustomerCreditInvoiceRow[]> =>
      tx.select(invoiceSelection()).from(invoicesTable)
        .leftJoin(jobsTable, eq(jobsTable.id, invoicesTable.jobId))
        .where(and(
          eq(invoicesTable.customerId, customerId),
          not(inArray(invoicesTable.status, ["voided", "credited"])),
          gt(invoicesTable.balanceDue, "0"),
        ))
        .orderBy(asc(invoicesTable.id)) as unknown as Promise<CustomerCreditInvoiceRow[]>,
    findPaymentById: async (paymentId) => {
      const [payment] = await tx.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
      return (payment as CustomerCreditPaymentRow | undefined) ?? null;
    },
    insertApplication: async (values) => {
      const [row] = await tx.insert(customerCreditApplicationsTable).values(values).returning({ id: customerCreditApplicationsTable.id });
      return row;
    },
    updateInvoice: async (invoiceId, values) => {
      const [invoice] = await tx.update(invoicesTable).set(values).where(eq(invoicesTable.id, invoiceId)).returning();
      if (!invoice) throw new Error(`Invoice #${invoiceId} disappeared during credit application`);
      const [job] = invoice.jobId
        ? await tx.select({ scheduledDate: jobsTable.scheduledDate }).from(jobsTable).where(eq(jobsTable.id, invoice.jobId))
        : [];
      return { ...invoice, serviceDate: job?.scheduledDate ?? null } as unknown as CustomerCreditInvoiceRow;
    },
    updatePayment: async (paymentId, values) => {
      const [payment] = await tx.update(paymentsTable).set(values).where(eq(paymentsTable.id, paymentId)).returning();
      if (!payment) throw new Error(`Payment #${paymentId} disappeared during credit application`);
      return payment as CustomerCreditPaymentRow;
    },
    insertPaymentAllocation: async (values) => {
      const [row] = await tx.insert(paymentAllocationsTable).values(values).returning({ id: paymentAllocationsTable.id });
      return row;
    },
    insertRefund: async (values) => {
      const [row] = await tx.insert(customerCreditRefundsTable).values(values).returning({ id: customerCreditRefundsTable.id });
      return row;
    },
    insertRefundAllocation: async (values) => {
      const [row] = await tx.insert(customerCreditRefundAllocationsTable).values(values).returning({ id: customerCreditRefundAllocationsTable.id });
      return row;
    },
  };
}

export async function assertCustomerExists(tx: CustomerCreditTransaction, customerId: number): Promise<void> {
  const [customer] = await tx.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Customer not found");
}