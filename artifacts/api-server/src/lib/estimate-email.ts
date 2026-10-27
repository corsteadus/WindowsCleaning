/**
 * The basic estimate email — phase 7, Kyle's Video 6 and answer #5: "a link that
 * opens the estimate as a PDF is the standard; attaching the PDF is an option."
 * The tags the office can put in the subject and message, and the message
 * Corstead starts with. Every value is HTML-escaped where it goes into the body.
 */
export const ESTIMATE_EMAIL_TAGS = [
  { tag: "{{estimate_link}}", label: "Link to the estimate (PDF)" },
  { tag: "{{estimate_page_link}}", label: "Link to accept or decline online" },
  { tag: "{{first_name}}", label: "Customer's first name" },
  { tag: "{{customer_name}}", label: "Customer's name" },
  { tag: "{{estimate_number}}", label: "Estimate number" },
  { tag: "{{estimate_total}}", label: "Estimate total" },
  { tag: "{{valid_until}}", label: "Valid until" },
  { tag: "{{business_name}}", label: "Your business name" },
  { tag: "{{sender_name}}", label: "Your name" },
] as const;

export const DEFAULT_ESTIMATE_SUBJECT = "Your estimate from {{business_name}} ({{estimate_number}})";
export const DEFAULT_ESTIMATE_BODY = [
  "<p>Hi {{first_name}},</p>",
  "<p>Thank you for having us out. Your estimate is ready: <a href=\"{{estimate_link}}\">view your estimate (PDF)</a>.</p>",
  "<p>The total is {{estimate_total}}, and the estimate is good until {{valid_until}}.</p>",
  "<p>If you have any questions, just reply to this email.</p>",
  "<p>Thank you,<br>{{sender_name}}<br>{{business_name}}</p>",
].join("\n");

export interface EstimateEmailValues {
  estimateLink: string;
  estimatePageLink: string;
  firstName: string;
  customerName: string;
  estimateNumber: string;
  estimateTotal: string;
  validUntil: string;
  businessName: string;
  senderName: string;
  /** Phase 8: the business's logo, shown at the top when it has one. */
  logoUrl?: string | null;
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const TAG_VALUES: Record<string, Exclude<keyof EstimateEmailValues, "logoUrl">> = {
  estimate_link: "estimateLink", estimate_page_link: "estimatePageLink", first_name: "firstName",
  customer_name: "customerName", estimate_number: "estimateNumber", estimate_total: "estimateTotal",
  valid_until: "validUntil", business_name: "businessName", sender_name: "senderName",
};

/** The subject (plain text) and the message (HTML, every value escaped). Unknown tags are left as written. */
export function renderEstimateEmail(subject: string, bodyHtml: string, values: EstimateEmailValues) {
  const fill = (text: string, escape: boolean) => text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const field = TAG_VALUES[key];
    if (!field) return whole;
    return escape ? escapeHtml(values[field]) : values[field];
  });
  // A readable font in every mail app, which otherwise falls back to Times.
  const logo = values.logoUrl
    ? `<p><img src="${escapeHtml(values.logoUrl)}" alt="${escapeHtml(values.businessName)}" style="max-height:56px;max-width:220px"></p>`
    : "";
  const body = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${logo}${fill(bodyHtml, true)}</div>`;
  return { subject: fill(subject, false).replace(/[\r\n]+/g, " ").trim(), bodyHtml: body };
}

/** Whether the customer can reach the estimate from this email at all. */
export function reachesEstimate(bodyHtml: string, attachPdf: boolean): boolean {
  return attachPdf || /\{\{estimate_(page_)?link\}\}/.test(bodyHtml);
}

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;
export const MAX_ESTIMATE_RECIPIENTS = 10;

/** The recipients as sent: 1–10 distinct, valid addresses, or why not. */
export function recipientsOf(raw: unknown): { recipients: string[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const recipients = [...new Set(list.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length) return { error: "Choose who to send the estimate to" };
  if (recipients.length > MAX_ESTIMATE_RECIPIENTS) return { error: `Send to at most ${MAX_ESTIMATE_RECIPIENTS} addresses at once` };
  const bad = recipients.find((email) => !EMAIL.test(email));
  if (bad) return { error: `${bad} is not an email address` };
  return { recipients };
}
