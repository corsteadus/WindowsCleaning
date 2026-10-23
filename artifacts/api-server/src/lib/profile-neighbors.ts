/**
 * Previous / Next beside a profile's name — Kyle's answers, 2026-10-21.
 *
 * "The arrows should only navigate through active profiles. Prospects should
 * navigate only through the Prospect database. Customers should navigate only
 * through the Customer database. Archived profiles should be excluded.
 * Residential profiles should be sorted alphabetically by last name. Commercial
 * profiles should be sorted alphabetically by company name, whether they're
 * prospects or customers."
 *
 * Two readings were ours, and are written down so they can be reversed:
 *
 *  - **One list, interleaved.** Residential and commercial profiles sit in a
 *    single alphabetical sequence, each by its own name — Atieh, Bright Glass
 *    Co, Carter — rather than every residential profile first. That is what
 *    "the customer database alphabetically" reads as; it is a question still
 *    open with Kyle.
 *  - **"Active" leaves out deactivated profiles as well as archived ones.** In
 *    this schema both have their own `lifecycle_status`, so asking for
 *    `prospect` or `customer` excludes them without a second rule.
 *
 * Kept pure so the ordering can be tested without a database.
 */

export interface NeighborRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  clientType: string | null;
}

export interface Neighbor {
  id: number;
  name: string;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

/** The name a profile is filed under. */
export function filingName(row: NeighborRow): string {
  const company = clean(row.companyName);
  // A commercial profile with no company name is filed by its contact, so it
  // is not lost at the front of the list under an empty string.
  if (row.clientType === "commercial" && company) return company;
  return clean(row.lastName) || company || clean(row.firstName);
}

/** What the arrow says: the company for commercial, "Last, First" otherwise. */
export function displayName(row: NeighborRow): string {
  const company = clean(row.companyName);
  if (row.clientType === "commercial" && company) return company;
  const last = clean(row.lastName);
  const first = clean(row.firstName);
  if (last && first) return `${last}, ${first}`;
  return last || first || company || `#${row.id}`;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Filing name, then first name, then id — so the order never wobbles. */
export function compareProfiles(a: NeighborRow, b: NeighborRow): number {
  return collator.compare(filingName(a), filingName(b))
    || collator.compare(clean(a.firstName), clean(b.firstName))
    || a.id - b.id;
}

/**
 * The profiles either side of `current` in the filing order.
 *
 * `current` need not be in `rows`: a profile opened from search may be
 * archived, and its arrows still lead to the nearest active profiles on each
 * side rather than going dead.
 */
export function neighborsOf(
  rows: readonly NeighborRow[],
  current: NeighborRow,
): { previous: Neighbor | null; next: Neighbor | null } {
  let previous: NeighborRow | null = null;
  let next: NeighborRow | null = null;
  for (const row of rows) {
    if (row.id === current.id) continue;
    const order = compareProfiles(row, current);
    if (order < 0 && (!previous || compareProfiles(row, previous) > 0)) previous = row;
    if (order > 0 && (!next || compareProfiles(row, next) < 0)) next = row;
  }
  const shape = (row: NeighborRow | null): Neighbor | null =>
    row ? { id: row.id, name: displayName(row) } : null;
  return { previous: shape(previous), next: shape(next) };
}
