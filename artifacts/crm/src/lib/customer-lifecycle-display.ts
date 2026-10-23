const CUSTOMER_LIFECYCLE_STATUSES = new Set(["prospect", "customer", "inactive", "archived"]);

export type CustomerLifecycleDisplayInput = {
  lifecycleStatus?: string | null;
  status?: string | null;
};

// Kyle (2026-10-24): "Archived and Deactivated should mean the same thing.
// We can use the term Deactivated." Both stored values show as one.
const asShown = (lifecycle: string) => (lifecycle === "inactive" || lifecycle === "archived" ? "deactivated" : lifecycle);

export function customerLifecycleDisplayStatus(
  customer: CustomerLifecycleDisplayInput,
): string {
  const canonical = customer.lifecycleStatus?.trim().toLowerCase();
  if (canonical && CUSTOMER_LIFECYCLE_STATUSES.has(canonical)) return asShown(canonical);

  const legacy = customer.status?.trim().toLowerCase();
  if (legacy === "active") return "customer";
  if (legacy && CUSTOMER_LIFECYCLE_STATUSES.has(legacy)) return asShown(legacy);
  return "customer";
}

/** Deactivated — whichever of the two stored values it was. */
export function isDeactivatedProfile(customer: CustomerLifecycleDisplayInput): boolean {
  return customerLifecycleDisplayStatus(customer) === "deactivated";
}