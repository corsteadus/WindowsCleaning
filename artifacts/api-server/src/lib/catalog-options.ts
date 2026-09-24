/**
 * Adding an option to a profile dropdown (Profile Type, Payment Terms, Profile
 * Group, Marketing Source — Kyle, Prospect Profile Notes #14).
 *
 * Removing an option only deactivates it, and `(catalog_type, code)` is unique,
 * so re-adding a removed option used to hit the unique index and surface a raw
 * "duplicate key" error. Re-adding now brings the old row back instead, which
 * also keeps every profile that still names it pointing at the same option.
 */

export type ExistingCatalogOption = { id: number; name: string; isActive: boolean } | undefined;

export type CatalogAddPlan =
  | { kind: "insert" }
  | { kind: "reactivate"; id: number }
  | { kind: "duplicate"; name: string };

export function catalogAddPlan(existing: ExistingCatalogOption): CatalogAddPlan {
  if (!existing) return { kind: "insert" };
  if (existing.isActive) return { kind: "duplicate", name: existing.name };
  return { kind: "reactivate", id: existing.id };
}

/** The stable code for an option name; never empty, so "!!!" and "???" cannot collide on "". */
export function catalogOptionCode(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || name.trim().toLowerCase();
}
