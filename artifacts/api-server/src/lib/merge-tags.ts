/**
 * One tag engine — A5 (Kyle, Video 8). Every message the office writes with
 * {{tags}} (a profile email, a text, a letter, the estimate and invoice emails,
 * the acceptance thank-you, a bulk send) is filled here, so a tag means the same
 * thing everywhere and is escaped the same way. Pure: no database.
 */
import { contactLines, formatPhone } from "./company-profile-rules.ts";

export const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const TAG = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Fills each {{tag}} it has a value for. An unknown tag is left as written, so a
 * typo shows in the preview instead of vanishing (`unknown: "blank"` removes it,
 * for the older bulk sends that always did). `escape` HTML-escapes each value.
 */
export function fillTags(
  text: string,
  values: Readonly<Record<string, string | null | undefined>>,
  options: { escape?: boolean; unknown?: "keep" | "blank" } = {},
): string {
  return text.replace(TAG, (whole, key: string) => {
    const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    if (value == null) return options.unknown === "blank" ? "" : whole;
    return options.escape ? escapeHtml(value) : value;
  });
}

/** The tags in the text that are not in the list, each once, as {{written}}. */
export function unknownTags(text: string, known: Iterable<string>): string[] {
  const allowed = new Set(known);
  const found = new Set<string>();
  for (const match of text.matchAll(TAG)) if (!allowed.has(match[1])) found.add(`{{${match[1]}}}`);
  return [...found];
}

/** Plain text to safe HTML: escaped, blank lines become paragraphs, single newlines breaks. */
export function textToHtml(text: string): string {
  return text.trim().split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML an older email was written in, back to the plain text the composer edits. */
export function htmlToText(html: string): string {
  return html
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The tags a message written on a profile can use, grouped as the composer shows them. */
export const PROFILE_TAGS = [
  { tag: "first_name", label: "First name", group: "Customer" },
  { tag: "last_name", label: "Last name", group: "Customer" },
  { tag: "full_name", label: "Full name", group: "Customer" },
  { tag: "customer_name", label: "Customer or company name", group: "Customer" },
  { tag: "company_name", label: "Company name", group: "Customer" },
  { tag: "salutation", label: "Greeting name (Mr. Smith)", group: "Customer" },
  { tag: "email", label: "Email", group: "Customer" },
  { tag: "phone", label: "Phone", group: "Customer" },
  { tag: "billing_address", label: "Mailing address (lines)", group: "Address" },
  { tag: "street", label: "Street", group: "Address" },
  { tag: "city_state_zip", label: "City, State ZIP", group: "Address" },
  { tag: "service_address", label: "Service location", group: "Address" },
  { tag: "service_type", label: "Last service", group: "History" },
  { tag: "last_service_date", label: "Last service date", group: "History" },
  { tag: "business_name", label: "Your business name", group: "Business" },
  { tag: "business_phone", label: "Your phone", group: "Business" },
  { tag: "business_email", label: "Your email", group: "Business" },
  { tag: "business_address", label: "Your address", group: "Business" },
  { tag: "business_website", label: "Your website", group: "Business" },
  { tag: "sender_name", label: "Your name", group: "Business" },
  { tag: "today", label: "Today's date", group: "Business" },
] as const;
export type ProfileTag = (typeof PROFILE_TAGS)[number]["tag"];
export const PROFILE_TAG_KEYS: readonly string[] = PROFILE_TAGS.map((t) => t.tag);

export interface ProfileTagSource {
  customer: {
    firstName: string; lastName: string; companyName?: string | null; salutation?: string | null;
    email?: string | null; phone?: string | null;
    billingAddress?: string | null; billingCity?: string | null; billingState?: string | null; billingZip?: string | null;
    clientType?: string | null;
  };
  serviceAddress?: string | null;
  lastService?: { type: string | null; date: string | null } | null;
  business: { businessName: string; address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; email: string | null; website: string | null };
  senderName: string | null;
  /** YYYY-MM-DD, the business's today. */
  today: string;
}

/** "October 29, 2026" from YYYY-MM-DD, without a timezone shifting the day. */
export function longDateOf(dateOnly: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly ?? "");
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** Every profile tag's value for one customer. A missing field is "", never the tag. */
export function profileTagValues(source: ProfileTagSource): Record<ProfileTag, string> {
  const c = source.customer;
  const first = clean(c.firstName);
  const last = clean(c.lastName);
  const full = [first, last].filter(Boolean).join(" ");
  const company = clean(c.companyName);
  const commercial = c.clientType === "commercial";
  const cityStateZip = [clean(c.billingCity), [clean(c.billingState), clean(c.billingZip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const street = clean(c.billingAddress);
  const b = source.business;
  const businessAddress = contactLines({ ...b, phone: null, email: null, website: null })[0] ?? "";
  return {
    first_name: first,
    last_name: last,
    full_name: full,
    customer_name: commercial && company ? company : full || company,
    company_name: company,
    salutation: clean(c.salutation) && last ? `${clean(c.salutation)} ${last}` : first || full,
    email: clean(c.email),
    phone: c.phone ? formatPhone(c.phone) : "",
    billing_address: [street, cityStateZip].filter(Boolean).join("\n"),
    street,
    city_state_zip: cityStateZip,
    service_address: clean(source.serviceAddress),
    service_type: clean(source.lastService?.type),
    last_service_date: longDateOf(source.lastService?.date),
    business_name: clean(b.businessName),
    business_phone: b.phone ? formatPhone(b.phone) : "",
    business_email: clean(b.email),
    business_address: businessAddress,
    business_website: clean(b.website),
    sender_name: clean(source.senderName),
    today: longDateOf(source.today),
  };
}

/** Why a message with these tags cannot be sent or saved, or null when every tag is known. */
export function unknownTagError(texts: Array<string | null | undefined>, known: readonly string[] = PROFILE_TAG_KEYS): string | null {
  const unknown = [...new Set(texts.flatMap((text) => unknownTags(text ?? "", known)))];
  if (!unknown.length) return null;
  return unknown.length === 1
    ? `${unknown[0]} is not a tag Corstead knows. Pick one from the list, or take it out.`
    : `${unknown.join(", ")} are not tags Corstead knows. Pick from the list, or take them out.`;
}
