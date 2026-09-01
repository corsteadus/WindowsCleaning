/**
 * customer-search.ts — request shaping for the shared CustomerCombobox.
 *
 * The CRM environment has thousands of customers (~3,000+), so creation
 * pages must NEVER preload the whole table: the API hard-caps `limit` at
 * 200, which means a preloading dropdown silently loses every customer past
 * the cap. Instead the combobox sends a debounced, SERVER-side search and
 * renders one bounded result page (API default 75 rows, ordered by
 * last/first name).
 *
 * The server's `search` param matches: first name, last name, full-name
 * concat ("Kyle Stafford" / "stafford kyle"), company name, email, phones,
 * billing city and import id — all case-insensitive ILIKE. Business-only
 * customers (e.g. #8894 "Conoco Gas Station") are therefore findable by
 * company name; no client-side lowercasing is needed.
 *
 * These helpers are pure so the exact request shape is unit-testable:
 * equal inputs ⇒ deeply-equal params ⇒ identical React Query cache keys
 * (keys derive from the params object), which is what de-duplicates
 * " Conoco " vs "Conoco" and isolates stale responses per term.
 */

export const CUSTOMER_SEARCH_DEBOUNCE_MS = 250;

export interface CustomerSearchParams {
  search?: string;
  status?: string;
}

export interface CustomerSearchOptions {
  /**
   * When true (the default — JobNew/QuoteNew behavior) results are scoped
   * to status "active". RecurringPlanNew passes false: its previous
   * preloaded dropdown listed customers of every status, and plans may
   * legitimately target customers that are not currently "active".
   */
  activeOnly?: boolean;
}

/**
 * Builds the /api/customers list params for a raw search-box value.
 *  - Trims the term; blank/whitespace input produces NO `search` key
 *    (server then returns the first alphabetical page — the browse state).
 *  - Omitted keys are truly ABSENT (not `undefined`), so param objects for
 *    equivalent inputs compare deeply equal and query keys dedupe.
 *  - Never emits `limit`/`page`: the bounded page is the server default.
 */
export function customerSearchParams(
  rawInput: string,
  options?: CustomerSearchOptions,
): CustomerSearchParams {
  const term = typeof rawInput === "string" ? rawInput.trim() : "";
  const params: CustomerSearchParams = {};
  if (term) params.search = term;
  if (options?.activeOnly !== false) params.status = "active";
  return params;
}
