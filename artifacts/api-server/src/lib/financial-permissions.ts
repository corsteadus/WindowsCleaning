import type { NextFunction, Request, Response } from "express";
import { normalizeAuthorizationRole } from "./role-normalization.ts";

export const FINANCIAL_CAPABILITIES = [
  "invoices.view",
  "invoices.manage",
  "reconciliation.view",
  "reconciliation.export",
  "payments.record",
  "customer_credit.apply",
  "refunds.record",
  "invoices.void",
  "invoices.credit",
  "invoices.reissue",
  "approvals.view",
  "approvals.decide",
  "approvals.manage",
  "automation_events.view",
  "automation_events.manage",
  "communication.view",
  "communication.manage",
  "communication.send",
  "communication.settings",
] as const;

export type FinancialCapability = (typeof FINANCIAL_CAPABILITIES)[number];

const DIRECT_FINANCIAL_CAPABILITIES: readonly FinancialCapability[] = [
  "reconciliation.view",
  "reconciliation.export",
  "payments.record",
  "customer_credit.apply",
  "refunds.record",
  "invoices.void",
  "invoices.credit",
  "invoices.reissue",
];

// Financial access is restricted to office roles. Legacy employee is a Field
// Tech compatibility role and therefore has no direct financial capabilities.
const ROLE_CAPABILITIES: Record<string, readonly FinancialCapability[]> = {
  super_admin: ["invoices.view", "invoices.manage", ...DIRECT_FINANCIAL_CAPABILITIES, "approvals.view", "approvals.decide", "approvals.manage", "automation_events.view", "automation_events.manage", "communication.view", "communication.manage", "communication.send", "communication.settings"],
  owner: ["invoices.view", "invoices.manage", ...DIRECT_FINANCIAL_CAPABILITIES, "approvals.view", "approvals.decide", "approvals.manage", "automation_events.view", "automation_events.manage", "communication.view", "communication.manage", "communication.send", "communication.settings"],
  admin: ["invoices.view", "invoices.manage", ...DIRECT_FINANCIAL_CAPABILITIES, "approvals.view", "approvals.decide", "automation_events.view", "communication.view", "communication.manage", "communication.send", "communication.settings"],
  office_admin: ["invoices.view", "invoices.manage", ...DIRECT_FINANCIAL_CAPABILITIES, "approvals.view", "approvals.decide", "communication.view", "communication.manage", "communication.send", "communication.settings"],
  employee: [],
};

export function getFinancialCapabilities(role: string | null | undefined): FinancialCapability[] {
  return [...(ROLE_CAPABILITIES[normalizeAuthorizationRole(role)] ?? [])];
}

export function hasFinancialCapability(
  role: string | null | undefined,
  capability: FinancialCapability,
): boolean {
  return getFinancialCapabilities(role).includes(capability);
}

export function actorName(req: Request): string {
  if (!req.user) return "Unknown user";
  const name = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return name || req.user.email || String(req.user.id);
}

export function requireFinancialCapability(capability: FinancialCapability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
      return;
    }
    if (!hasFinancialCapability(req.user.role, capability)) {
      res.status(403).json({
        error: "You do not have permission to perform this financial action",
        code: "financial_capability_required",
        capability,
      });
      return;
    }
    next();
  };
}

export function requireAuthenticatedFinancialUser(
  capability: FinancialCapability,
  req: Request,
  res: Response,
): boolean {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return false;
  }
  if (!hasFinancialCapability(req.user.role, capability)) {
    res.status(403).json({
      error: "You do not have permission to perform this financial action",
      code: "financial_capability_required",
      capability,
    });
    return false;
  }
  return true;
}