const CUSTOMER_LIFECYCLE_STATUSES = new Set(["prospect", "customer", "inactive", "archived"]);

export type CustomerLifecycleDisplayInput = {
  lifecycleStatus?: string | null;
  status?: string | null;
};

export function customerLifecycleDisplayStatus(
  customer: CustomerLifecycleDisplayInput,
): string {
  const canonical = customer.lifecycleStatus?.trim().toLowerCase();
  if (canonical && CUSTOMER_LIFECYCLE_STATUSES.has(canonical)) return canonical;

  const legacy = customer.status?.trim().toLowerCase();
  if (legacy === "active") return "customer";
  if (legacy && CUSTOMER_LIFECYCLE_STATUSES.has(legacy)) return legacy;
  return "customer";
}