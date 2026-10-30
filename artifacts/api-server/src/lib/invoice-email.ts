/**
 * The invoice email — A3 (Kyle, Video 7), the same way the estimate is sent: the
 * office picks the profile's addresses, keeps or writes the message with tags,
 * and the customer gets a link to their invoice (page or PDF) or the PDF attached.
 * Every value is HTML-escaped where it goes into the body.
 */
import { escapeHtml, fillTags } from "./merge-tags.ts";

export const INVOICE_EMAIL_TAGS = [
  { tag: "{{invoice_page_link}}", label: "Link to the invoice" },
  { tag: "{{invoice_link}}", label: "Link to the invoice (PDF)" },
  { tag: "{{first_name}}", label: "Customer's first name" },
  { tag: "{{customer_name}}", label: "Customer's name" },
  { tag: "{{invoice_number}}", label: "Invoice number" },
  { tag: "{{invoice_total}}", label: "Invoice total" },
  { tag: "{{balance_due}}", label: "Balance due" },
  { tag: "{{due_date}}", label: "Due date" },
  { tag: "{{business_name}}", label: "Your business name" },
  { tag: "{{sender_name}}", label: "Your name" },
] as const;

export const DEFAULT_INVOICE_SUBJECT = "Invoice {{invoice_number}} from {{business_name}}";

export interface InvoiceEmailValues {
  invoiceLink: string;
  invoicePageLink: string;
  firstName: string;
  customerName: string;
  invoiceNumber: string;
  invoiceTotal: string;
  balanceDue: string;
  dueDate: string;
  businessName: string;
  senderName: string;
  logoUrl?: string | null;
}

const TAG_VALUES: Record<string, Exclude<keyof InvoiceEmailValues, "logoUrl">> = {
  invoice_link: "invoiceLink", invoice_page_link: "invoicePageLink", first_name: "firstName",
  customer_name: "customerName", invoice_number: "invoiceNumber", invoice_total: "invoiceTotal",
  balance_due: "balanceDue", due_date: "dueDate", business_name: "businessName", sender_name: "senderName",
};

/** The subject (plain text) and the message (HTML, every value escaped). Unknown tags are left as written. */
export function renderInvoiceEmail(subject: string, bodyHtml: string, values: InvoiceEmailValues) {
  const byTag = Object.fromEntries(Object.entries(TAG_VALUES).map(([tag, field]) => [tag, values[field]]));
  const fill = (text: string, escape: boolean) => fillTags(text, byTag, { escape });
  const logo = values.logoUrl
    ? `<p><img src="${escapeHtml(values.logoUrl)}" alt="${escapeHtml(values.businessName)}" style="max-height:56px;max-width:220px"></p>`
    : "";
  const body = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a">${logo}${fill(bodyHtml, true)}</div>`;
  return { subject: fill(subject, false).replace(/[\r\n]+/g, " ").trim(), bodyHtml: body };
}

/** Whether the customer can reach the invoice from this email at all. */
export function reachesInvoice(bodyHtml: string, attachPdf: boolean): boolean {
  return attachPdf || /\{\{invoice_(page_)?link\}\}/.test(bodyHtml);
}
