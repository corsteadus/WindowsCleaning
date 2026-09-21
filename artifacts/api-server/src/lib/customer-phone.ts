/**
 * `customers.phone` is a legacy column kept for back-compat and mapped to the
 * home phone. Nothing in the current UI writes it — the profile form writes
 * `cellPhone`, `homePhone` and `workPhone` — so surfacing `phone` alone shows
 * no number at all for every customer created since. This picks the number a
 * crew should actually call, in the order a person would try them.
 */

export interface CustomerPhoneFields {
  phone?: string | null;
  cellPhone?: string | null;
  homePhone?: string | null;
  workPhone?: string | null;
}

export function primaryCustomerPhone(customer: CustomerPhoneFields | null | undefined): string | null {
  if (!customer) return null;
  for (const candidate of [customer.cellPhone, customer.homePhone, customer.phone, customer.workPhone]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}
