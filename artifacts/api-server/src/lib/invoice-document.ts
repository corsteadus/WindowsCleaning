/**
 * The invoice as the customer sees it — A3 (Kyle, Video 7). One view feeds the
 * customer's page, the PDF and the email, so they never disagree. Unlike an
 * estimate, an invoice is not frozen when sent: it shows what is paid and still
 * owed now, so a customer opening an old email sees today's balance. The
 * invoice's Notes are the office's and are not shown to the customer.
 */
import { PdfDocument, type PdfPage, textWidth, wrapText } from "./pdf-writer.ts";

export interface InvoiceViewLine {
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface InvoiceView {
  invoiceNumber: string;
  status: string;
  /** When the invoice was made (ISO). */
  issuedAt: string;
  dueDate: string | null;
  paidAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  serviceAddress: string | null;
  lines: InvoiceViewLine[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  /** What credit notes took off the balance. */
  credited: number;
  balanceDue: number;
}

export type InvoiceStanding = "paid" | "voided" | "credited" | "overdue" | "due" | "draft";

const n = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Where the invoice stands for the customer: paid, cancelled, credited, overdue or due. */
export function invoiceStanding(view: Pick<InvoiceView, "status" | "balanceDue" | "dueDate">, today: string): InvoiceStanding {
  if (view.status === "voided") return "voided";
  if (view.status === "credited") return "credited";
  if (view.status === "paid" || (view.balanceDue <= 0 && view.status !== "draft")) return "paid";
  if (view.status === "draft") return "draft";
  if (view.status === "overdue" || (view.dueDate && view.dueDate.slice(0, 10) < today)) return "overdue";
  return "due";
}

/** The invoice's lines; one written before invoices had lines is shown as one line for its subtotal. */
export function viewLines(
  lines: Array<{ description: string; quantity: unknown; unitPrice: unknown; discountAmount?: unknown; taxAmount?: unknown; lineTotal: unknown }>,
  subtotal: number,
): InvoiceViewLine[] {
  if (!lines.length) {
    return [{ description: "Services", quantity: 1, unitPrice: subtotal, discountAmount: 0, taxAmount: 0, lineTotal: subtotal }];
  }
  return lines.map((line) => ({
    description: line.description, quantity: n(line.quantity), unitPrice: n(line.unitPrice),
    discountAmount: n(line.discountAmount), taxAmount: n(line.taxAmount), lineTotal: n(line.lineTotal),
  }));
}

export function invoicePdfFilename(invoiceNumber: string) {
  return `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

export interface InvoicePdfContext {
  businessName: string;
  /** Today, in the business's time zone (YYYY-MM-DD), for "overdue". */
  today: string;
  branding?: {
    contactLines?: string[];
    logo?: { jpeg: Buffer; width: number; height: number } | null;
    footer?: string | null;
  };
}

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const GREEN: [number, number, number] = [4, 120, 87];
const RED: [number, number, number] = [185, 28, 28];
const SHADE: [number, number, number] = [241, 245, 249];
const M = 48;
const RIGHT = 612 - M;
const COL = { qty: 400, price: 480, amount: RIGHT };
const DESC_WIDTH = 300;
const BOTTOM = 792 - 64;

export const money = (value: number) => `$${(Math.round(value * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
/** "March 4, 2026" for a date or a timestamp, read as the business's day. */
export const longDate = (iso: string) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso
    : new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const STAMP: Partial<Record<InvoiceStanding, [string, [number, number, number]]>> = {
  paid: ["PAID", GREEN], voided: ["VOID", MUTED], credited: ["CREDITED", MUTED], overdue: ["OVERDUE", RED],
};

export function renderInvoicePdf(view: InvoiceView, context: InvoicePdfContext): Buffer {
  const doc = new PdfDocument(`Invoice ${view.invoiceNumber}`);
  let page = doc.addPage();
  let y = M;
  const brand = context.branding ?? {};
  const footerLines = brand.footer?.trim() ? wrapText(brand.footer.trim(), "regular", 7.5, RIGHT - M).slice(0, 3) : [];
  const bottom = BOTTOM - footerLines.length * 10;
  const standing = invoiceStanding(view, context.today);

  const tableHeader = () => {
    page.rect(M, y, RIGHT - M, 22, SHADE);
    page.text(M + 8, y + 6, "SERVICE", { font: "bold", size: 8, color: MUTED });
    page.text(COL.qty, y + 6, "QTY", { font: "bold", size: 8, color: MUTED, align: "right" });
    page.text(COL.price, y + 6, "PRICE", { font: "bold", size: 8, color: MUTED, align: "right" });
    page.text(COL.amount - 8, y + 6, "AMOUNT", { font: "bold", size: 8, color: MUTED, align: "right" });
    y += 28;
  };
  const room = (height: number, withHeader = false) => {
    if (y + height <= bottom) return;
    page = doc.addPage();
    y = M;
    if (withHeader) tableHeader();
  };

  // ── Header: the business on the left, INVOICE and its facts on the right ────
  const headerTop = y;
  if (brand.logo) {
    const scale = Math.min(180 / brand.logo.width, 56 / brand.logo.height, 1);
    const w = brand.logo.width * scale;
    const h = brand.logo.height * scale;
    page.image(doc.addJpeg(brand.logo.jpeg, brand.logo.width, brand.logo.height), M, y, w, h);
    y += h + 8;
  }
  page.text(M, y, context.businessName, { font: "bold", size: brand.logo ? 12 : 15 });
  y += brand.logo ? 16 : 20;
  for (const line of (brand.contactLines ?? []).slice(0, 2)) {
    page.text(M, y, line, { size: 8.5, color: MUTED });
    y += 11;
  }
  page.text(RIGHT, headerTop - 2, "INVOICE", { font: "bold", size: 20, align: "right" });
  const leftBottom = y;
  y = headerTop + 30;
  const facts: Array<[string, string]> = [["Invoice", view.invoiceNumber], ["Date", longDate(view.issuedAt)]];
  facts.push(["Due", view.dueDate ? longDate(view.dueDate) : "Upon receipt"]);
  if (standing === "paid" && view.paidAt) facts.push(["Paid", longDate(view.paidAt)]);
  for (const [label, value] of facts) {
    page.text(RIGHT - textWidth(value, "bold", 9) - 10, y, label, { size: 9, color: MUTED, align: "right" });
    page.text(RIGHT, y, value, { font: "bold", size: 9, align: "right" });
    y += 14;
  }
  const stamp = STAMP[standing];
  if (stamp) {
    page.text(RIGHT, y + 2, stamp[0], { font: "bold", size: 13, color: stamp[1], align: "right" });
    y += 20;
  }
  y = Math.max(y, leftBottom) + 10;

  // ── Bill to ────────────────────────────────────────────────────────────────
  page.text(M, y, "BILL TO", { font: "bold", size: 8, color: MUTED });
  y += 13;
  if (view.customerName) { page.text(M, y, view.customerName, { font: "bold", size: 11 }); y += 15; }
  for (const contact of [view.customerEmail, view.customerPhone].filter(Boolean) as string[]) {
    page.text(M, y, contact, { size: 9, color: MUTED }); y += 12;
  }
  if (view.serviceAddress) { page.text(M, y, `Service address: ${view.serviceAddress}`, { size: 9, color: MUTED }); y += 12; }
  y += 14;

  // ── Services ───────────────────────────────────────────────────────────────
  tableHeader();
  for (const line of view.lines) {
    const title = wrapText(line.description || "Service", "bold", 10, DESC_WIDTH);
    const extras = [
      line.discountAmount > 0 ? `Discount –${money(line.discountAmount)}` : null,
      line.taxAmount > 0 ? `Tax ${money(line.taxAmount)}` : null,
    ].filter(Boolean).join(" · ");
    room(title.length * 13 + (extras ? 11 : 0) + 10, true);
    const top = y;
    for (const t of title) { page.text(M + 8, y, t, { font: "bold", size: 10 }); y += 13; }
    if (extras) { page.text(M + 8, y, extras, { size: 8.5, color: MUTED }); y += 11; }
    page.text(COL.qty, top, quantity(line.quantity), { size: 10, align: "right" });
    page.text(COL.price, top, money(line.unitPrice), { size: 10, align: "right" });
    page.text(COL.amount - 8, top, money(line.lineTotal), { font: "bold", size: 10, align: "right" });
    y += 6;
    page.line(M, y, RIGHT, y);
    y += 8;
  }

  // ── Totals, then what is paid and what is still owed ───────────────────────
  const rows: Array<[string, string, [number, number, number]?]> = [["Subtotal", money(view.subtotal)]];
  if (view.taxAmount > 0) rows.push(["Sales tax", money(view.taxAmount)]);
  rows.push(["Total", money(view.totalAmount)]);
  if (view.amountPaid > 0) rows.push(["Paid", `–${money(view.amountPaid)}`, GREEN]);
  if (view.credited > 0) rows.push(["Credited", `–${money(view.credited)}`, GREEN]);
  room(rows.length * 16 + 44);
  y += 4;
  const labelX = RIGHT - 230;
  for (const [label, value, color] of rows) {
    page.text(labelX, y, label, { size: 9.5, color: color ?? MUTED });
    page.text(RIGHT - 8, y, value, { size: 10, align: "right", color: color ?? INK });
    y += 16;
  }
  page.line(labelX, y, RIGHT, y, [148, 163, 184], 1);
  y += 8;
  const owed = standing === "voided" || standing === "credited" ? 0 : Math.max(0, view.balanceDue);
  page.text(labelX, y + 2, "Balance due", { font: "bold", size: 12 });
  page.text(RIGHT - 8, y, money(owed), { font: "bold", size: 15, align: "right", color: standing === "overdue" ? RED : INK });
  y += 30;

  doc.pages.forEach((p: PdfPage, i) => {
    footerLines.forEach((line, k) => p.text(M, 792 - 50 - (footerLines.length - k) * 10, line, { size: 7.5, color: MUTED }));
    p.line(M, 792 - 44, RIGHT, 792 - 44);
    p.text(M, 792 - 38, `${context.businessName} · Invoice ${view.invoiceNumber}`, { size: 8, color: MUTED });
    p.text(RIGHT, 792 - 38, `Page ${i + 1} of ${doc.pages.length}`, { size: 8, color: MUTED, align: "right" });
  });
  return doc.toBuffer();
}
