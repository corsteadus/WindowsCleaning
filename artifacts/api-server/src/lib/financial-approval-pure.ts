import { createHash } from "node:crypto";

export const FINANCIAL_APPROVAL_ACTIONS = [
  "refunds.record",
  "invoices.credit",
  "invoices.void",
  "invoices.reissue",
  "customer_credit.apply",
] as const;

export type FinancialApprovalAction = (typeof FINANCIAL_APPROVAL_ACTIONS)[number];

export type ApprovalPolicySnapshot = {
  policyId: number;
  actionType: FinancialApprovalAction;
  enabled: boolean;
  thresholdCents: string | null;
  distinctApprover: boolean;
};

export class FinancialApprovalValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FinancialApprovalValidationError";
    this.code = code;
  }
}

export function stableApprovalValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stableApprovalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableApprovalValue(item)]),
    );
  }
  return value;
}

export function canonicalApprovalPayload(value: unknown): string {
  return JSON.stringify(stableApprovalValue(value));
}

export function approvalPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalApprovalPayload(value)).digest("hex");
}

export function parseApprovalAmountCents(value: unknown): bigint {
  const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new FinancialApprovalValidationError(
      "invalid_amount",
      "Approval amounts must be non-negative decimals with at most two decimal places",
    );
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function approvalRequired(
  policy: { enabled: boolean; thresholdCents: string | null } | null,
  amountCents: bigint,
): boolean {
  if (!policy?.enabled) return false;
  if (policy.thresholdCents == null) return true;
  return amountCents >= BigInt(policy.thresholdCents);
}