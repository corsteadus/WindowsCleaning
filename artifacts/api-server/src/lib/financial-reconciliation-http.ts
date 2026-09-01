import type {
  ReconciliationFilters,
  ReconciliationSourceOrigin,
  ReconciliationSummary,
  ReconciliationTransaction,
  ReconciliationTransactionKind,
} from "./financial-reconciliation-core.js";
import { resolveFinancialReconciliationRange } from "./financial-reconciliation-core.ts";

export function parseFinancialReconciliationRequest(
  query: Record<string, unknown>,
  now?: Date,
) {
  return {
    range: resolveFinancialReconciliationRange({
      startDate: query.startDate,
      endDate: query.endDate,
      now,
    }),
    filters: parseFilters(query),
  };
}

export class FinancialReconciliationHttpValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialReconciliationHttpValidationError";
    this.code = code;
  }
}

const TRANSACTION_KINDS = new Set<ReconciliationTransactionKind>([
  "payment",
  "refund",
  "invoice_credit",
  "customer_credit_application",
]);
const SOURCES = new Set(["payment", "credit_note"]);

export function parseFilters(query: Record<string, unknown>): ReconciliationFilters {
  const kind = query.kind == null || query.kind === "" ? undefined : String(query.kind);
  const source = query.source == null || query.source === "" ? undefined : String(query.source);
  const method = query.method == null || query.method === "" ? undefined : String(query.method).trim();
  if (kind && !TRANSACTION_KINDS.has(kind as ReconciliationTransactionKind)) {
    throw new FinancialReconciliationHttpValidationError("invalid_kind", "Transaction kind is not supported");
  }
  if (source && !SOURCES.has(source)) {
    throw new FinancialReconciliationHttpValidationError("invalid_source", "Source must be payment or credit_note");
  }
  if (method && !/^[a-zA-Z0-9 _-]{1,40}$/.test(method)) {
    throw new FinancialReconciliationHttpValidationError("invalid_method", "Payment method filter is invalid");
  }
  return {
    kind: kind as ReconciliationTransactionKind | undefined,
    source: source as ReconciliationSourceOrigin | undefined,
    method,
  };
}

export function parsePage(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = query.page == null || query.page === "" ? 1 : Number(query.page);
  const pageSize = query.pageSize == null || query.pageSize === "" ? 50 : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) {
    throw new FinancialReconciliationHttpValidationError("invalid_pagination", "Page must be a positive integer");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new FinancialReconciliationHttpValidationError("invalid_pagination", "Page size must be between 1 and 200");
  }
  return { page, pageSize };
}

export function serializeTransaction(transaction: ReconciliationTransaction) {
  return {
    ...transaction,
    amount: (transaction.amountCents / 100).toFixed(2),
  };
}

export function transactionRows(
  transactions: ReconciliationTransaction[],
  page: number,
  pageSize: number,
) {
  const total = transactions.length;
  const start = (page - 1) * pageSize;
  return {
    rows: transactions.slice(start, start + pageSize).map(serializeTransaction),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function transactionCsv(
  transactions: ReconciliationTransaction[],
  summary: ReconciliationSummary,
): string {
  const lines = [
    ["Date", "Type", "Record ID", "Amount", "Cash classification", "Method", "Source origin", "Customer ID", "Invoice ID", "Invoice number", "Description"],
    ...transactions.map((transaction) => [
      transaction.date,
      transaction.recordType,
      transaction.recordId,
      (transaction.amountCents / 100).toFixed(2),
      transaction.cashClass,
      transaction.method ?? "",
      transaction.sourceOrigin ?? "",
      transaction.customerId ?? "",
      transaction.invoiceId ?? "",
      transaction.invoiceNumber ?? "",
      transaction.label,
    ]),
    [],
    ["Cash received", "", "", (summary.cashReceivedCents / 100).toFixed(2)],
    ["Recorded refunds", "", "", (summary.recordedRefundsCents / 100).toFixed(2)],
    ["Net recorded cash activity", "", "", (summary.netRecordedCashActivityCents / 100).toFixed(2)],
    ["Invoice credits (non-cash)", "", "", (summary.invoiceCreditsCents / 100).toFixed(2)],
    ["Customer-credit applications (non-cash)", "", "", (summary.customerCreditApplicationsCents / 100).toFixed(2)],
  ];
  return `${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}