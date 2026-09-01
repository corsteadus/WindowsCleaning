/**
 * Pure customer display-name resolver.
 *
 * Deterministic priority (never returns a blank/whitespace-only string):
 *   a. trimmed "first last" when either person-name component is non-blank;
 *   b. trimmed companyName when the person name is empty (business-only records);
 *   c. "Customer #<id>" when both are empty and a usable id exists;
 *   d. the generic "Customer" only when no id exists.
 *
 * Rationale: enrichment paths previously built `${firstName} ${lastName}`,
 * which yields a *truthy* single space " " for blank-name records (e.g. a
 * business-only customer whose names are empty strings), defeating every
 * downstream `||`-style fallback and rendering blank labels on Schedule cards.
 *
 * The resolver also refuses to emit the literal strings "undefined"/"null"
 * that template interpolation of missing values can produce upstream.
 */

export interface CustomerNameParts {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

/** Trim a value to a safe display token; "" when unusable. */
function clean(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return t;
}

export function customerDisplayName(
  parts: CustomerNameParts | null | undefined,
  id?: number | string | null,
): string {
  const first = clean(parts?.firstName);
  const last = clean(parts?.lastName);
  if (first || last) return [first, last].filter(Boolean).join(" ");

  const company = clean(parts?.companyName);
  if (company) return company;

  if (typeof id === "number" && Number.isFinite(id)) return `Customer #${id}`;
  if (typeof id === "string") {
    const idToken = clean(id);
    if (idToken) return `Customer #${idToken}`;
  }
  return "Customer";
}
