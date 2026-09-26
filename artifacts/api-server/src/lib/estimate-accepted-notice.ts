/**
 * What the office is told when a customer accepts an estimate.
 *
 * Kyle, 2026-09-24 #2: *"When an estimate is accepted, also send an email
 * notification to the company's main office email address … Acceptance should
 * alert the office that action is required. The system should not automatically
 * convert the prospect to a customer or automatically schedule the job."*
 *
 * So the notice says plainly that nothing has been booked. It also names what
 * the customer turned down, because a partial acceptance that reads like a
 * whole one is how the wrong job gets scheduled.
 */

export interface NoticeLine {
  description: string;
  totalPrice: number;
}

export interface AcceptedNoticeInput {
  quoteNumber: string;
  customerName?: string | null;
  acceptedTotal: number;
  accepted: readonly NoticeLine[];
  declined: readonly NoticeLine[];
  /** A link straight to the estimate in Corstead, when the server knows its address. */
  estimateUrl?: string | null;
}

export interface OfficeNotice {
  subject: string;
  text: string;
  html: string;
}

/** Names and service descriptions are somebody else's text; it never reaches the inbox as markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const money = (value: number) =>
  `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function officeAcceptedNotice(input: AcceptedNoticeInput): OfficeNotice {
  const who = (input.customerName ?? "").trim() || "A customer";
  const offered = input.accepted.length + input.declined.length;
  const partial = input.declined.length > 0;
  const scope = partial ? `${input.accepted.length} of ${offered} services` : "the whole estimate";

  const subject = `${input.quoteNumber} accepted by ${who} — ${scope}, ${money(input.acceptedTotal)}`;

  const lines = [
    `${who} accepted ${scope} on estimate ${input.quoteNumber}.`,
    "",
    `Accepted (${money(input.acceptedTotal)}):`,
    ...input.accepted.map((line) => `  • ${line.description} — ${money(line.totalPrice)}`),
  ];
  if (partial) {
    lines.push("", "Not accepted:", ...input.declined.map((line) => `  • ${line.description} — ${money(line.totalPrice)}`));
  }
  lines.push(
    "",
    "Nothing has been scheduled and no job has been created. Open the estimate in Corstead to convert it into a job.",
  );
  if (input.estimateUrl) lines.push("", input.estimateUrl);

  const listHtml = (items: readonly NoticeLine[]) =>
    `<ul style="margin:6px 0 0;padding-left:20px">${items
      .map((line) => `<li>${escapeHtml(line.description)} — <strong>${money(line.totalPrice)}</strong></li>`)
      .join("")}</ul>`;

  const html = [
    `<p style="margin:0 0 12px"><strong>${escapeHtml(who)}</strong> accepted ${escapeHtml(scope)} on estimate <strong>${escapeHtml(input.quoteNumber)}</strong>.</p>`,
    `<p style="margin:0"><strong>Accepted (${money(input.acceptedTotal)})</strong></p>`,
    listHtml(input.accepted),
    partial ? `<p style="margin:14px 0 0"><strong>Not accepted</strong></p>${listHtml(input.declined)}` : "",
    `<p style="margin:16px 0 0;padding:10px 12px;background:#fef3c7;border-radius:8px">Nothing has been scheduled and no job has been created. Open the estimate in Corstead to convert it into a job.</p>`,
    input.estimateUrl
      ? `<p style="margin:14px 0 0"><a href="${escapeHtml(input.estimateUrl)}">Open the estimate</a></p>`
      : "",
  ].join("");

  return { subject, text: lines.join("\n"), html };
}

/**
 * The company's main office address. There is no company settings store yet, so
 * it is configuration; when Phase 11 builds Settings this moves there.
 */
export function officeEmailAddress(env: Record<string, string | undefined>): string | null {
  const address = (env.OFFICE_EMAIL_ADDRESS ?? env.EMAIL_FROM_ADDRESS ?? "").trim();
  return address && address.includes("@") ? address : null;
}
