/**
 * The company's quote settings, as a form.
 *
 * Kyle (Testing Edits, 2026-10-01):
 *
 * - **#11** *"Add a company-level Admin setting where the business chooses how
 *   many days a quote remains valid. Examples could include 15, 30, 60, or 90
 *   days, plus the ability to enter another number of days."* Hence four
 *   buttons and an "Other" box.
 * - **#13** *"Do not provide any default Corstead terms and conditions. Leave
 *   Terms & Conditions blank by default … Corstead should not provide legal
 *   wording or suggest specific terms."*
 *
 * So there is **no sample terms text in this file**, not even as a placeholder
 * that could be mistaken for a suggestion.
 *
 * The twin of `api-server/src/lib/quote-settings.ts`. The bounds are repeated
 * rather than imported because the packages do not share code; the server is
 * the one that decides, and `quote-settings-form.test.ts` keeps the two honest.
 */

export const QUOTE_VALIDITY_PRESETS: readonly number[] = [15, 30, 60, 90];
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
export const MIN_QUOTE_VALIDITY_DAYS = 1;
export const MAX_QUOTE_VALIDITY_DAYS = 365;
export const MAX_QUOTE_TERMS_LENGTH = 20_000;

export interface QuoteSettingsDraft {
  /** A string because it comes from an input. */
  validityDays: string;
  terms: string;
}

export interface SavedQuoteSettings {
  validityDays: number;
  terms: string | null;
}

export function draftFromSaved(saved: SavedQuoteSettings): QuoteSettingsDraft {
  return { validityDays: String(saved.validityDays), terms: saved.terms ?? "" };
}

/** Which control owns the current value: a preset button, or the Other box. */
export function validityChoice(value: string): number | "other" {
  const days = Number(value);
  return QUOTE_VALIDITY_PRESETS.includes(days) ? days : "other";
}

export function validateQuoteSettingsDraft(draft: QuoteSettingsDraft): string | null {
  const raw = draft.validityDays.trim();
  if (raw === "") return "Choose how many days a quote stays valid";
  const days = Number(raw);
  if (!Number.isInteger(days)) return "Quote validity must be a whole number of days";
  if (days < MIN_QUOTE_VALIDITY_DAYS || days > MAX_QUOTE_VALIDITY_DAYS) {
    return `Quote validity must be between ${MIN_QUOTE_VALIDITY_DAYS} and ${MAX_QUOTE_VALIDITY_DAYS} days`;
  }
  if (draft.terms.trim().length > MAX_QUOTE_TERMS_LENGTH) {
    return `Terms and conditions must be ${MAX_QUOTE_TERMS_LENGTH} characters or fewer`;
  }
  return null;
}

/** What goes to the server. An empty box means the company has no terms. */
export function quoteSettingsBody(draft: QuoteSettingsDraft): SavedQuoteSettings {
  return {
    validityDays: Number(draft.validityDays.trim()),
    terms: draft.terms.trim() || null,
  };
}

export function isQuoteSettingsDirty(draft: QuoteSettingsDraft, saved: SavedQuoteSettings): boolean {
  const body = quoteSettingsBody(draft);
  if (draft.validityDays.trim() !== String(saved.validityDays)) {
    if (Number.isNaN(body.validityDays) || body.validityDays !== saved.validityDays) return true;
  }
  return body.terms !== (saved.terms ?? null);
}

/**
 * `YYYY-MM-DD`, `days` after `from`. Calendar arithmetic on an opaque date, at
 * midday so a daylight-saving shift cannot move the day.
 */
export function addDays(from: string, days: number): string {
  const [year, month, day] = from.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

/** Today in the business's own timezone, as the server would read it. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** When a quote raised now would expire, under the company's setting. */
export function expiryPreview(validityDays: number, now: Date = new Date()): string {
  return addDays(businessToday(now), validityDays);
}

/** A date-only value as a person reads it: "3 Nov 2026" → "Nov 3, 2026". */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}
