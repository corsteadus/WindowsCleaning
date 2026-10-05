/**
 * One profile sitting beneath another.
 *
 * Kyle (2026-09-23, answer #5): *"Linking only. Any profile can sit beneath a
 * main profile, residential or commercial, one or many. **No 'bill to parent',
 * no combined invoices** — linking changes nothing about billing. Can come
 * later; must not delay the basics."*
 *
 * So this is a link and nothing else. No invoice, payment, credit or statement
 * code reads it, and `customer-hierarchy.test.ts` checks that none starts to.
 *
 * **Two levels.** A main profile has profiles beneath it, and those have none of
 * their own. Kyle said "beneath a main profile", which reads as two; chains
 * would also mean deciding what a grandparent's invoices, totals and lists do,
 * which is exactly the "later" he warned against. Deeper nesting is a later
 * change to this one function, not a rewrite — and it is question 5 on the list
 * waiting for him.
 */

export type MainProfileDecision =
  | { kind: "link"; parentCustomerId: number }
  | { kind: "unlink" }
  | { kind: "error"; status: number; message: string };

export interface MainProfileRequest {
  /** The profile being given, or losing, a main profile. */
  customerId: number;
  /** Null or absent asks for it to stand on its own again. */
  requestedParentId: number | null;
  /** Whether the requested main profile exists at all. */
  parentExists: boolean;
  /** The requested main profile is itself beneath somebody: two levels only. */
  parentHasParent: boolean;
  /** This profile already has profiles beneath it: it cannot also be under one. */
  customerHasChildren: boolean;
  /** An archived profile is a poor thing to hang live work beneath. */
  parentIsArchived?: boolean;
}

export function decideMainProfile(request: MainProfileRequest): MainProfileDecision {
  const { customerId, requestedParentId } = request;
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return { kind: "error", status: 400, message: "Customer id must be a positive integer" };
  }
  if (requestedParentId === null || requestedParentId === undefined) {
    return { kind: "unlink" };
  }
  if (!Number.isInteger(requestedParentId) || requestedParentId <= 0) {
    return { kind: "error", status: 400, message: "Main profile id must be a positive integer" };
  }
  if (requestedParentId === customerId) {
    return { kind: "error", status: 400, message: "A profile cannot sit beneath itself" };
  }
  if (!request.parentExists) {
    return { kind: "error", status: 404, message: "That main profile does not exist" };
  }
  if (request.parentIsArchived) {
    return { kind: "error", status: 409, message: "An archived profile cannot be a main profile" };
  }
  if (request.parentHasParent) {
    return {
      kind: "error",
      status: 409,
      message: "That profile already sits beneath another one, and Corstead keeps this to one level",
    };
  }
  if (request.customerHasChildren) {
    return {
      kind: "error",
      status: 409,
      message: "This profile already has profiles beneath it, so it cannot sit beneath another",
    };
  }
  return { kind: "link", parentCustomerId: requestedParentId };
}

/** What the activity log records, in the words the office would use. */
export function describeMainProfileChange(
  decision: MainProfileDecision,
  names: { customer: string; parent?: string },
): string {
  if (decision.kind === "link") {
    return `${names.customer} now sits beneath ${names.parent ?? "another profile"}`;
  }
  if (decision.kind === "unlink") {
    return `${names.customer} no longer sits beneath another profile`;
  }
  return decision.message;
}

/**
 * The statement that frees the profiles beneath one being deleted.
 *
 * A sub-customer is a separate profile, not a belonging: erasing a main profile
 * must leave its sub-profiles standing, with nothing above them. The column's
 * own `ON DELETE SET NULL` would do it, but the purge counts what still points
 * at the profile afterwards, and an explicit statement is what the rest of that
 * file does for leads.
 */
export const SUB_PROFILE_UNLINK =
  "UPDATE customers SET parent_customer_id = NULL WHERE parent_customer_id = :id";
