/**
 * Which list a profile belongs to — Kyle, 2026-10-24:
 *
 *   "Prospects and Customers should remain in their own separate databases and
 *    lists." … "Archived and Deactivated should mean the same thing." A
 *    deactivated profile "is removed from the normal active customer or
 *    prospect list … can be reactivated and returned to the active list."
 *
 * `inactive` and `archived` are both "deactivated". A deactivated profile still
 * belongs to its list: `deactivated_from` says which, and for a profile
 * deactivated before that column existed, whether it ever became a customer.
 */
export type ProfileList = "prospect" | "customer";

export const DEACTIVATED_LIFECYCLES = ["inactive", "archived"] as const;

export function isDeactivated(lifecycle: string | null | undefined): boolean {
  return (DEACTIVATED_LIFECYCLES as readonly string[]).includes(String(lifecycle ?? ""));
}

export interface ListedProfile {
  lifecycleStatus?: string | null;
  deactivatedFrom?: string | null;
  customerDate?: string | Date | null;
}

export function listOf(profile: ListedProfile): ProfileList {
  if (profile.lifecycleStatus === "prospect" || profile.lifecycleStatus === "customer") return profile.lifecycleStatus;
  if (profile.deactivatedFrom === "prospect" || profile.deactivatedFrom === "customer") return profile.deactivatedFrom;
  return profile.customerDate ? "customer" : "prospect";
}

/** A /prospects/… route serves an active prospect, or one deactivated from the prospect list. */
export function inProspectScope(profile: ListedProfile): boolean {
  return profile.lifecycleStatus === "prospect" || (isDeactivated(profile.lifecycleStatus) && listOf(profile) === "prospect");
}

/**
 * The lifecycle a status request should end in. "Reactivate" arrives as the
 * old `status: "active"`, which used to mean customer — and turned a
 * reactivated prospect into a customer. From a deactivated profile it now
 * means "back to your own list". An explicit lifecycleStatus is honoured.
 */
export function resolvedLifecycle(
  current: ListedProfile,
  requested: string,
  explicit: boolean,
): string {
  if (!explicit && isDeactivated(current.lifecycleStatus) && !isDeactivated(requested)) return listOf(current);
  return requested;
}
