/**
 * Which address opened an estimate — A2, Video 7. The estimate's link is shared
 * by everyone it was sent to, so each recipient's copy carries a key of its own
 * (`?r=`). The key only says whose copy it was: the link token is still what
 * opens the estimate, and a missing or unknown key is simply an unattributed open.
 */
import { createHash, randomBytes } from "node:crypto";

export const openKeyHash = (key: string) => createHash("sha256").update(`estimate-open:${key}`).digest("hex");

export function newOpenKey(): { key: string; hash: string } {
  const key = randomBytes(12).toString("base64url");
  return { key, hash: openKeyHash(key) };
}

/** 16 base64url characters, as `newOpenKey` makes them; anything else is ignored. */
export const isValidOpenKey = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16}$/.test(value);

/** The recipient's own copy of a link: the same address with their key added. */
export function withOpenKey(url: string, key: string | null | undefined): string {
  if (!key) return url;
  return `${url}${url.includes("?") ? "&" : "?"}r=${encodeURIComponent(key)}`;
}

/**
 * The office is told of an address's first open at once, then at most once a
 * day however often it is opened (the recommendation put to Kyle).
 */
export const OPEN_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function openNoticeDue(lastNotifiedAt: Date | string | null | undefined, now: Date): boolean {
  if (!lastNotifiedAt) return true;
  return now.getTime() - new Date(lastNotifiedAt).getTime() >= OPEN_NOTICE_INTERVAL_MS;
}

/**
 * Reloading the page, or the PDF opening after the page, is not a new visit: an
 * open within half an hour of the last one from the same copy is neither counted
 * again nor written as a new history line.
 */
export const OPEN_VISIT_GAP_MS = 30 * 60 * 1000;
export function isNewVisit(lastOpenedAt: Date | string | null | undefined, now: Date): boolean {
  if (!lastOpenedAt) return true;
  return now.getTime() - new Date(lastOpenedAt).getTime() >= OPEN_VISIT_GAP_MS;
}
