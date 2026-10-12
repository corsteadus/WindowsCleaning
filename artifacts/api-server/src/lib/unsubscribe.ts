import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The unsubscribe link in a customer-facing email — Kyle's correction note #6.
 *
 * #6 asks that every customer-facing email carry an Unsubscribe link, that
 * using it keeps the address on the profile but stops Corstead writing to it,
 * and that the office can see why an address was switched off and turn it
 * back on. The reasons it asks for already exist, as the `reason` column on
 * `communication_suppressions`:
 *
 *   Customer Unsubscribed  -> marketing_unsubscribe
 *   Email Bounced          -> provider_permanent_failure
 *   Manually Deactivated   -> manual
 *
 * So nothing new is stored, and no migration is needed. What was missing is
 * the link, and a screen that shows the state.
 *
 * **The link is signed.** An unsigned one that simply named the address would
 * let anybody unsubscribe anybody else's customers by typing an email into a
 * URL. The token carries the address and a keyed hash of it, and the hash is
 * compared in constant time.
 *
 * **The secret may be absent**, and that must not produce a forgeable link or
 * a broken one. With no secret there is no link at all — the email carries a
 * written instruction instead, which still gives the customer a way out.
 */

export const UNSUBSCRIBE_PATH = "/api/public/unsubscribe";

/** Exactly the normalisation the suppression list uses, so the two agree. */
export function unsubscribeAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function unsubscribeSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = (env.UNSUBSCRIBE_SECRET ?? "").trim();
  // A short secret is worse than none: it looks configured and is not.
  return secret.length >= 16 ? secret : null;
}

const b64url = (value: Buffer | string): string =>
  (Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unB64url = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(address: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(address, "utf8").digest());
}

export function unsubscribeToken(email: string, secret: string): string {
  const address = unsubscribeAddress(email);
  return `${b64url(address)}.${sign(address, secret)}`;
}

/** The address a token stands for, or null if it was not signed by us. */
export function readUnsubscribeToken(token: unknown, secret: string | null): string | null {
  if (!secret || typeof token !== "string") return null;
  // A token is short. Anything long is somebody probing.
  if (token.length === 0 || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  if (token.indexOf(".", dot + 1) !== -1) return null;

  let address: string;
  try {
    address = unB64url(token.slice(0, dot)).toString("utf8");
  } catch {
    return null;
  }
  if (!address || address !== unsubscribeAddress(address)) return null;

  const offered = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(address, secret), "utf8");
  if (offered.length !== expected.length) return null;
  return timingSafeEqual(offered, expected) ? address : null;
}

/**
 * The link for one recipient, or null when it cannot be built honestly —
 * no secret, or nowhere for the customer to go.
 */
export function unsubscribeLink(
  baseUrl: string | null | undefined,
  email: string,
  secret: string | null,
): string | null {
  const root = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!root || !secret || !unsubscribeAddress(email)) return null;
  return `${root}${UNSUBSCRIBE_PATH}/${unsubscribeToken(email, secret)}`;
}

export const UNSUBSCRIBE_FALLBACK =
  "To stop receiving emails like this, reply to this message and ask to be removed.";

/**
 * Every customer-facing email gets a footer. With a link when one can be
 * built, and with the written instruction when it cannot — silence is the one
 * option #6 rules out.
 */
export function withUnsubscribeFooter(html: string, link: string | null): string {
  const body = typeof html === "string" ? html : "";
  const footer = link
    ? `<p style="margin-top:24px;font-size:12px;color:#64748b">`
      + `Don't want these emails? <a href="${link}" style="color:#64748b">Unsubscribe</a>.`
      + `</p>`
    : `<p style="margin-top:24px;font-size:12px;color:#64748b">${UNSUBSCRIBE_FALLBACK}</p>`;
  return `${body}${footer}`;
}

/** Whether a body already carries one, so a retry does not add a second. */
export function hasUnsubscribeFooter(html: string): boolean {
  return typeof html === "string"
    && (html.includes(UNSUBSCRIBE_PATH) || html.includes(UNSUBSCRIBE_FALLBACK));
}

/**
 * What the office reads on the profile. The stored reason is a code; these
 * are Kyle's own words for the three he named, and nothing is invented for a
 * code he did not.
 */
const REASON_LABELS: Record<string, string> = {
  marketing_unsubscribe: "Customer unsubscribed",
  provider_permanent_failure: "Email bounced",
  manual: "Manually deactivated",
  complaint: "Reported as spam",
  invalid: "Address is not valid",
};

export function suppressionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Deactivated";
  return REASON_LABELS[reason] ?? "Deactivated";
}
