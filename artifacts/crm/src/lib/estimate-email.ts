/**
 * The estimate email as the office writes it — phase 7. Plain text with tags;
 * Corstead turns it into the HTML that is sent: blank lines make paragraphs,
 * everything typed is escaped, and the two link tags become real links.
 */
export const DEFAULT_ESTIMATE_TEXT = [
  "Hi {{first_name}},",
  "",
  "Thank you for having us out. Your estimate is ready: {{estimate_link}}",
  "",
  "The total is {{estimate_total}}, and the estimate is good until {{valid_until}}.",
  "",
  "If you have any questions, just reply to this email.",
  "",
  "Thank you,",
  "{{sender_name}}",
  "{{business_name}}",
].join("\n");

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function estimateTextToHtml(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/).map((paragraph) => {
    const html = escapeHtml(paragraph).replace(/\n/g, "<br>")
      .replace(/\{\{estimate_link\}\}/g, '<a href="{{estimate_link}}">View your estimate (PDF)</a>')
      .replace(/\{\{estimate_page_link\}\}/g, '<a href="{{estimate_page_link}}">Accept or decline online</a>');
    return `<p>${html}</p>`;
  }).join("\n");
}

/** Whether the customer can reach the estimate from this email (the server checks the same). */
export const reachesEstimate = (text: string, attachPdf: boolean) => attachPdf || /\{\{estimate_(page_)?link\}\}/.test(text);
