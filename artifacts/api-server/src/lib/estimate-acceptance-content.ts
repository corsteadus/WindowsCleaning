/**
 * What the customer sees, and is emailed, after accepting an estimate online —
 * Videos 7 and 9. Kyle: "the business user can edit this form and customize the
 * message … the customer sees after acceptance", and a short email "thanks them
 * for accepting their proposal, confirms the acceptance, and lets them know that
 * we will be contacting them shortly". Only for the customer's own acceptance:
 * an office user converting a prospect is a different event and sends nothing.
 *
 * The business writes plain text with {{tags}}; it is escaped before it becomes
 * HTML, so a customer's name or note can never become markup.
 */
import { escapeHtml } from "./estimate-accepted-notice.ts";

export const MAX_CUSTOMER_NOTES = 2000;
export const MAX_ACCEPTANCE_MESSAGE = 4000;
export const MAX_ACCEPTANCE_SUBJECT = 300;
export const MAX_ACCEPTANCE_BODY = 10000;

export const ACCEPTANCE_TAGS = [
  "first_name", "customer_name", "estimate_number", "accepted_services", "accepted_total", "customer_notes", "business_name",
] as const;
export type AcceptanceValues = Record<(typeof ACCEPTANCE_TAGS)[number], string>;

export const DEFAULT_ACCEPTANCE_MESSAGE =
  "Thank you, {{first_name}}! We have your acceptance and will contact you shortly to schedule the work.";
export const DEFAULT_ACCEPTANCE_SUBJECT = "Thank you for accepting estimate {{estimate_number}}";
export const DEFAULT_ACCEPTANCE_BODY = [
  "Hi {{first_name}},",
  "",
  "Thank you for accepting estimate {{estimate_number}}. Here is what you accepted:",
  "{{accepted_services}}",
  "",
  "Total: {{accepted_total}}",
  "",
  "We will be in touch shortly to schedule the work.",
  "",
  "{{business_name}}",
].join("\n");

export interface AcceptanceSettings {
  acceptanceMessage: string | null;
  acceptanceEmailEnabled: boolean;
  acceptanceEmailSubject: string | null;
  acceptanceEmailBody: string | null;
}

/** Fills the tags; an unknown tag is left as typed, so a typo shows rather than vanishing. */
export function fillAcceptanceTags(template: string, values: AcceptanceValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, tag: string) =>
    (ACCEPTANCE_TAGS as readonly string[]).includes(tag) ? values[tag as keyof AcceptanceValues] : whole);
}

/** Plain text to safe HTML: escaped, blank lines become paragraphs, single newlines breaks. */
export function acceptanceTextToHtml(text: string): string {
  return text.trim().split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 12px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function acceptanceMessage(settings: AcceptanceSettings, values: AcceptanceValues): string {
  return fillAcceptanceTags(settings.acceptanceMessage?.trim() || DEFAULT_ACCEPTANCE_MESSAGE, values);
}

export function acceptanceEmail(settings: AcceptanceSettings, values: AcceptanceValues) {
  const subject = fillAcceptanceTags(settings.acceptanceEmailSubject?.trim() || DEFAULT_ACCEPTANCE_SUBJECT, values).replace(/\s+/g, " ").trim();
  const text = fillAcceptanceTags(settings.acceptanceEmailBody?.trim() || DEFAULT_ACCEPTANCE_BODY, values);
  return { subject, text, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b">${acceptanceTextToHtml(text)}</div>` };
}

/** The customer's note, trimmed and bounded; empty is none. */
export function customerNotesOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_CUSTOMER_NOTES) : null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** What the office saved, or the reason it cannot be. Blank boxes mean Corstead's default wording. */
export function acceptanceSettingsOf(body: Record<string, unknown>): { settings: AcceptanceSettings } | { error: string } {
  for (const key of ["acceptanceMessage", "acceptanceEmailSubject", "acceptanceEmailBody"]) {
    if (body[key] != null && typeof body[key] !== "string") return { error: "The thank-you wording must be text" };
  }
  if (typeof body.acceptanceEmailEnabled !== "boolean") return { error: "Say whether the thank-you email is sent" };
  const settings: AcceptanceSettings = {
    acceptanceMessage: textOrNull(body.acceptanceMessage),
    acceptanceEmailEnabled: body.acceptanceEmailEnabled,
    acceptanceEmailSubject: textOrNull(body.acceptanceEmailSubject),
    acceptanceEmailBody: textOrNull(body.acceptanceEmailBody),
  };
  if ((settings.acceptanceMessage?.length ?? 0) > MAX_ACCEPTANCE_MESSAGE) return { error: `The thank-you message must be ${MAX_ACCEPTANCE_MESSAGE} characters or fewer` };
  if ((settings.acceptanceEmailSubject?.length ?? 0) > MAX_ACCEPTANCE_SUBJECT) return { error: `The email subject must be ${MAX_ACCEPTANCE_SUBJECT} characters or fewer` };
  if ((settings.acceptanceEmailBody?.length ?? 0) > MAX_ACCEPTANCE_BODY) return { error: `The email must be ${MAX_ACCEPTANCE_BODY} characters or fewer` };
  return { settings };
}

export const money = (value: number) =>
  `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The tag values for one acceptance. */
export function acceptanceValues(input: {
  firstName?: string | null; customerName?: string | null; quoteNumber: string; businessName: string;
  accepted: ReadonlyArray<{ description: string }>; acceptedTotal: number; customerNotes: string | null;
}): AcceptanceValues {
  const customerName = (input.customerName ?? "").trim();
  return {
    first_name: (input.firstName ?? "").trim() || customerName.split(/\s+/)[0] || "there",
    customer_name: customerName,
    estimate_number: input.quoteNumber,
    accepted_services: input.accepted.map((line) => `• ${line.description}`).join("\n"),
    accepted_total: money(input.acceptedTotal),
    customer_notes: input.customerNotes ?? "",
    business_name: input.businessName,
  };
}

/** The addresses the estimate went to; the profile's own when it was never emailed. */
export function thankYouRecipients(deliveries: ReadonlyArray<{ channel: string; recipient: string }>, profileEmail?: string | null): string[] {
  const emails = [...new Set(deliveries.filter((d) => d.channel === "email").map((d) => d.recipient.trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (emails.length) return emails;
  const own = (profileEmail ?? "").trim().toLowerCase();
  return own.includes("@") ? [own] : [];
}
