/**
 * The invoice email as the office writes it — A3. Plain text with tags, the
 * same way as the estimate email: blank lines make paragraphs, everything typed
 * is escaped, and the two link tags become real links.
 */
export const DEFAULT_INVOICE_TEXT = [
  "Hi {{first_name}},",
  "",
  "Thank you for your business. Your invoice {{invoice_number}} is ready: {{invoice_page_link}}",
  "",
  "The balance due is {{balance_due}}, due {{due_date}}.",
  "",
  "If you have any questions, just reply to this email.",
  "",
  "Thank you,",
  "{{sender_name}}",
  "{{business_name}}",
].join("\n");

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function invoiceTextToHtml(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/).map((paragraph) => {
    const html = escapeHtml(paragraph).replace(/\n/g, "<br>")
      .replace(/\{\{invoice_page_link\}\}/g, '<a href="{{invoice_page_link}}">View your invoice</a>')
      .replace(/\{\{invoice_link\}\}/g, '<a href="{{invoice_link}}">Download your invoice (PDF)</a>');
    return `<p>${html}</p>`;
  }).join("\n");
}

/** Whether the customer can reach the invoice from this email (the server checks the same). */
export const reachesInvoice = (text: string, attachPdf: boolean) => attachPdf || /\{\{invoice_(page_)?link\}\}/.test(text);
