export const CUSTOMER_LIFECYCLE_STATUSES = [
  "prospect",
  "customer",
  "inactive",
  "archived",
] as const;

export type CustomerLifecycleStatus = (typeof CUSTOMER_LIFECYCLE_STATUSES)[number];

export const ACCOUNT_TYPES = ["residential", "commercial"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function parseLifecycleStatus(value: unknown): CustomerLifecycleStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CUSTOMER_LIFECYCLE_STATUSES.includes(normalized as CustomerLifecycleStatus)
    ? normalized as CustomerLifecycleStatus
    : null;
}

export function lifecycleStatusFromLegacyStatus(value: unknown): CustomerLifecycleStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "active") return "customer";
  return parseLifecycleStatus(normalized);
}

export function legacyStatusFromLifecycleStatus(value: CustomerLifecycleStatus): string {
  return value === "customer" ? "active" : value;
}

export function normalizeAccountType(value: unknown): AccountType {
  return String(value ?? "").trim().toLowerCase() === "commercial"
    ? "commercial"
    : "residential";
}

export function customerLifecycleStatus(customer: {
  lifecycleStatus?: string | null;
  status?: string | null;
}): CustomerLifecycleStatus {
  return (
    parseLifecycleStatus(customer.lifecycleStatus)
    ?? lifecycleStatusFromLegacyStatus(customer.status)
    ?? "customer"
  );
}