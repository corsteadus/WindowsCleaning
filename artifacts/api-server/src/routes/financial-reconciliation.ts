import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import {
  db,
  customerCreditApplicationsTable,
  customerCreditRefundAllocationsTable,
  customerCreditRefundsTable,
  customerCreditSourcesTable,
  customersTable,
  invoiceCreditNotesTable,
  invoicesTable,
  paymentAllocationsTable,
  paymentsTable,
} from "@workspace/db";
import { customerDisplayName } from "../lib/customer-display.js";
import {
  buildFinancialReconciliation,
  centsToMoney,
  moneyToCents,
  FinancialReconciliationValidationError,
  type ReconciliationSnapshot,
} from "../lib/financial-reconciliation-core.js";
import {
  FinancialReconciliationHttpValidationError,
  parseFilters,
  parseFinancialReconciliationRequest,
  parsePage,
  transactionCsv,
  transactionRows,
} from "../lib/financial-reconciliation-http.js";
import { requireFinancialCapability } from "../lib/financial-permissions.js";

const router: IRouter = Router();

function errorResponse(res: any, error: unknown): void {
  if (error instanceof FinancialReconciliationValidationError || error instanceof FinancialReconciliationHttpValidationError) {
    res.status(400).json({ error: error.message, code: error.code });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Failed to build financial reconciliation" });
}

async function readSnapshot() {
  return db.transaction(async (tx) => {
    const [
      payments,
      paymentAllocations,
      persistedSources,
      applications,
      refunds,
      refundAllocations,
      creditNotes,
      invoices,
      customers,
    ] = await Promise.all([
      tx.select().from(paymentsTable).orderBy(asc(paymentsTable.id)),
      tx.select().from(paymentAllocationsTable).orderBy(asc(paymentAllocationsTable.id)),
      tx.select().from(customerCreditSourcesTable).orderBy(asc(customerCreditSourcesTable.id)),
      tx.select().from(customerCreditApplicationsTable).orderBy(asc(customerCreditApplicationsTable.id)),
      tx.select().from(customerCreditRefundsTable).orderBy(asc(customerCreditRefundsTable.id)),
      tx.select().from(customerCreditRefundAllocationsTable).orderBy(asc(customerCreditRefundAllocationsTable.id)),
      tx.select().from(invoiceCreditNotesTable).orderBy(asc(invoiceCreditNotesTable.id)),
      tx.select().from(invoicesTable).orderBy(asc(invoicesTable.id)),
      tx.select({
        id: customersTable.id,
        firstName: customersTable.firstName,
        lastName: customersTable.lastName,
        companyName: customersTable.companyName,
      }).from(customersTable).orderBy(asc(customersTable.id)),
    ]);

    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const applicationsBySource = new Map<string, bigint>();
    for (const application of applications) {
      applicationsBySource.set(
        application.sourceKey,
        (applicationsBySource.get(application.sourceKey) ?? 0n) + moneyToCents(application.amount),
      );
    }
    const refundsBySource = new Map<string, bigint>();
    for (const allocation of refundAllocations) {
      refundsBySource.set(
        allocation.sourceKey,
        (refundsBySource.get(allocation.sourceKey) ?? 0n) + moneyToCents(allocation.amount),
      );
    }
    const sources = persistedSources.map((source) => {
      const payment = source.sourceType === "payment" ? paymentById.get(source.sourceId) : null;
      const availableAmount = source.sourceType === "payment"
        ? payment?.unappliedAmount ?? "0.00"
        : centsToMoney(
            [
              moneyToCents(source.originalAmount) -
                (applicationsBySource.get(source.sourceKey) ?? 0n) -
                (refundsBySource.get(source.sourceKey) ?? 0n),
              0n,
            ].reduce((smallest, value) => value > smallest ? value : smallest),
          );
      return { ...source, sourceType: source.sourceType === "payment" ? "payment" as const : "credit_note" as const, availableAmount };
    });

    const snapshot: ReconciliationSnapshot = {
      payments,
      paymentAllocations,
      sources,
      applications: applications.map((application) => ({
        ...application,
        origin: application.origin === "payment" ? "payment" as const : "credit_note" as const,
      })),
      refunds,
      refundAllocations,
      creditNotes,
      invoices,
    };
    return {
      snapshot,
      customers: customers.map((customer) => ({
        id: customer.id,
        name: customerDisplayName(customer, customer.id),
      })),
    };
  });
}

router.get("/financial-reconciliation/summary", requireFinancialCapability("reconciliation.view"), async (req, res): Promise<void> => {
  try {
    const { range, filters } = parseFinancialReconciliationRequest(req.query as Record<string, unknown>);
    const { snapshot, customers } = await readSnapshot();
    const result = buildFinancialReconciliation(snapshot, range, customers, filters);
    res.json(result.summary);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-reconciliation/transactions", requireFinancialCapability("reconciliation.view"), async (req, res): Promise<void> => {
  try {
    const { range, filters } = parseFinancialReconciliationRequest(req.query as Record<string, unknown>);
    const { page, pageSize } = parsePage(req.query as Record<string, unknown>);
    const { snapshot, customers } = await readSnapshot();
    const result = buildFinancialReconciliation(snapshot, range, customers, filters);
    res.json(transactionRows(result.transactions, page, pageSize));
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-reconciliation/discrepancies", requireFinancialCapability("reconciliation.view"), async (req, res): Promise<void> => {
  try {
    const { range } = parseFinancialReconciliationRequest(req.query as Record<string, unknown>);
    const { snapshot, customers } = await readSnapshot();
    const result = buildFinancialReconciliation(snapshot, range, customers);
    res.json({
      range,
      total: result.discrepancies.length,
      discrepancies: result.discrepancies,
    });
  } catch (error) {
    errorResponse(res, error);
  }
});

router.get("/financial-reconciliation/export.csv", requireFinancialCapability("reconciliation.export"), async (req, res): Promise<void> => {
  try {
    const { range, filters } = parseFinancialReconciliationRequest(req.query as Record<string, unknown>);
    const { snapshot, customers } = await readSnapshot();
    const result = buildFinancialReconciliation(snapshot, range, customers, filters);
    res
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="financial-reconciliation-${range.startDate}-${range.endDate}.csv"`)
      .send(transactionCsv(result.transactions, result.summary));
  } catch (error) {
    errorResponse(res, error);
  }
});

export default router;