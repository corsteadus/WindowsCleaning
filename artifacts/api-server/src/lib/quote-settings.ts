/**
 * How long a quote stays valid, and the terms the company puts on it.
 *
 * Kyle (Testing Edits, 2026-10-01):
 *
 * - **#11** *"Do not require the user to manually enter a specific Valid Until
 *   date on every quote. Add a company-level Admin setting where the business
 *   chooses how many days a quote remains valid. Examples could include 15, 30,
 *   60, or 90 days, plus the ability to enter another number of days. Corstead
 *   should automatically calculate the quote expiration date from that company
 *   setting."*
 * - **#12** *"When a quote reaches the company-defined validity period, do not
 *   delete it … the secure customer-facing link should become inactive."*
 * - **#13** *"Do not provide any default Corstead terms and conditions."*
 *
 * There is deliberately **no default terms text in this file**. Blank means
 * blank: Corstead offers no legal wording of its own.
 */
import { addDaysToDateOnly, businessDateStr, BUSINESS_TIME_ZONE } from "./date.ts";

export { BUSINESS_TIME_ZONE };

/** The choices Kyle named. Any other whole number of days is allowed too. */
export const QUOTE_VALIDITY_PRESETS: readonly number[] = [15, 30, 60, 90];
export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;
export const MIN_QUOTE_VALIDITY_DAYS = 1;
export const MAX_QUOTE_VALIDITY_DAYS = 365;
export const MAX_QUOTE_TERMS_LENGTH = 20_000;

export interface QuoteSettingsValues {
  validityDays: number;
  /** Null when the company has written none. Never a Corstead default. */
  terms: string | null;
}

export const DEFAULT_QUOTE_SETTINGS: QuoteSettingsValues = {
  validityDays: DEFAULT_QUOTE_VALIDITY_DAYS,
  terms: null,
};

/**
 * A whole number of days inside the allowed range, or null if the value is not
 * one. Accepts the string a form sends as well as a number.
 */
export function normaliseValidityDays(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  if (n < MIN_QUOTE_VALIDITY_DAYS || n > MAX_QUOTE_VALIDITY_DAYS) return null;
  return n;
}

/** Trimmed terms, or null. An empty box means the company has none. */
export function normaliseQuoteTerms(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The reason the input cannot be saved, or null when it can. */
export function validateQuoteSettingsInput(input: {
  validityDays?: unknown;
  terms?: unknown;
}): string | null {
  if (normaliseValidityDays(input.validityDays) === null) {
    return `Quote validity must be a whole number of days between ${MIN_QUOTE_VALIDITY_DAYS} and ${MAX_QUOTE_VALIDITY_DAYS}`;
  }
  if (input.terms !== null && input.terms !== undefined && typeof input.terms !== "string") {
    return "Terms and conditions must be text";
  }
  if (typeof input.terms === "string" && input.terms.trim().length > MAX_QUOTE_TERMS_LENGTH) {
    return `Terms and conditions must be ${MAX_QUOTE_TERMS_LENGTH} characters or fewer`;
  }
  return null;
}

/** The zone's offset from UTC, in minutes, at a given instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The last instant of `date` (a `YYYY-MM-DD`) in the given zone. Resolved twice
 * because the offset itself depends on the instant — the second pass is what
 * gets a date on either side of a daylight-saving change right.
 */
export function endOfDayInZone(date: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [year, month, day] = date.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  let instant = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  instant = new Date(naive - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

export interface QuoteExpiry {
  /** The date shown on the quote, in the business's own zone. */
  validUntil: string;
  /** When the customer's link stops working: the end of that last day. */
  expiresAt: Date;
}

/**
 * The expiry of a quote raised at `from`, under a company validity of
 * `validityDays`. Counted in business days-of-the-calendar, not in milliseconds,
 * so a quote raised at nine in the evening is not a day short.
 */
export function quoteExpiryFor(
  from: Date,
  validityDays: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): QuoteExpiry {
  const days = normaliseValidityDays(validityDays) ?? DEFAULT_QUOTE_VALIDITY_DAYS;
  const validUntil = addDaysToDateOnly(businessDateStr(from), days);
  return { validUntil, expiresAt: endOfDayInZone(validUntil, timeZone) };
}

/** Whether a quote has outlived its validity. #12: the record stays, the link dies. */
export function hasQuoteExpired(expiresAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}
