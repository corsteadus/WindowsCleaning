/**
 * "Customer Since" is set by the system, never typed (Kyle, Prospect Profile
 * Notes #4: "should automatically populate … should not be manually
 * editable").
 *
 * It records the day an account became a customer: the day it was created, if
 * it was created as a customer, or the day a prospect was converted. A prospect
 * has no Customer Since date yet. Once set it is never moved, so reactivating an
 * old customer does not reset their history.
 */

export type LifecycleLike = string | null | undefined;

/** The Customer Since date for a new account, or null for anything but a customer. */
export function customerSinceOnCreate(lifecycle: LifecycleLike, today: string): string | null {
  return lifecycle === "customer" ? today : null;
}

/**
 * The Customer Since date to write when an account moves between lifecycle
 * states, or undefined when it must be left alone.
 */
export function customerSinceOnTransition(
  current: { lifecycle: LifecycleLike; customerSince: string | null | undefined },
  nextLifecycle: LifecycleLike,
  today: string,
): string | undefined {
  if (nextLifecycle !== "customer") return undefined;
  if (current.lifecycle === "customer") return undefined;
  if (current.customerSince) return undefined;
  return today;
}

/** Drops a client-supplied Customer Since value. Mutates and returns `fields`. */
export function withoutClientCustomerSince<T extends Record<string, unknown>>(fields: T): T {
  delete fields.customerDate;
  return fields;
}
