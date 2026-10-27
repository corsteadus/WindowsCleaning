/**
 * The estimate as a PDF — phase 7, Kyle's Video 6 and answer #5: the basic estimate
 * is "a plain PDF, no Accept button", opened from a link in the email or attached
 * to it. Drawn from the same snapshot the customer's page shows, so the PDF, the
 * page and the totals can never disagree (lib/discounts.ts, lib/sales-tax.ts).
 */
import { PdfDocument, type PdfPage, textWidth, wrapText } from "./pdf-writer.ts";
import { applyDiscounts, type DiscountInput } from "./discounts.ts";
import { salesTax } from "./sales-tax.ts";

export interface EstimatePdfSnapshot {
  quote: { quoteNumber: string; notes?: string | null; terms?: string | null; validUntil?: string | null };
  lineItems: Array<{
    description: string; quantity: number; unitPrice: number | null; totalPrice: number;
    propertyId?: number | null; serviceNotes?: string | null; taxable?: boolean;
  }>;
  locations: Array<{ id: number; name?: string | null; address: string; city?: string | null; state?: string | null; zip?: string | null }>;
  discounts?: DiscountInput[];
  tax?: { rate: number; label: string | null } | null;
}

export interface EstimatePdfContext {
  businessName: string;
  customerName: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** When the estimate was finalized (or now, for a draft). */
  date: Date;
  revisionNumber?: number | null;
  /** A draft is marked as one, so nobody mistakes it for what was sent. */
  draft?: boolean;
  /** Phase 8 (Kyle, Video 6): the business's own identity and choices. */
  branding?: {
    contactLines?: string[];
    logo?: { jpeg: Buffer; width: number; height: number } | null;
    footer?: string | null;
    showUnitPrices?: boolean;
    showServiceDescriptions?: boolean;
  };
}

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const GREEN: [number, number, number] = [4, 120, 87];
const SHADE: [number, number, number] = [241, 245, 249];
const M = 48;           // page margin
const RIGHT = 612 - M;  // right edge
const COL = { qty: 400, price: 480, amount: RIGHT };
const DESC_WIDTH = 300;
const BOTTOM = 792 - 64;

const money = (value: number) => `$${(Math.round(value * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
const chicagoDate = (date: Date) => date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const dateOnly = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};
/** A location's own name; "Primary service property" says nothing, so it is left out. */
const placeName = (l: EstimatePdfSnapshot["locations"][number]) =>
  l.name?.trim() && !/^primary service property$/i.test(l.name.trim()) ? l.name.trim() : null;
/** (816) 555-0177 for a plain ten-digit number; anything else as written. */
const phoneText = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 && !/[a-z+]/i.test(raw) ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}` : raw;
};
const placeLine = (l: EstimatePdfSnapshot["locations"][number]) =>
  [l.address, [l.city, [l.state, l.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");

/** The estimate's money, worked out by the same rules as everywhere else. */
export function estimatePdfTotals(snapshot: EstimatePdfSnapshot) {
  const subtotal = snapshot.lineItems.reduce((sum, line) => sum + Math.round(Number(line.totalPrice) * 100), 0) / 100;
  const discounted = applyDiscounts(subtotal, snapshot.discounts ?? []);
  const tax = salesTax(snapshot.lineItems.map((l) => ({ totalPrice: Number(l.totalPrice), taxable: Boolean(l.taxable) })), discounted.discountTotal, snapshot.tax?.rate ?? null).tax;
  return { ...discounted, tax, total: (Math.round(discounted.total * 100) + Math.round(tax * 100)) / 100 };
}

export function renderEstimatePdf(snapshot: EstimatePdfSnapshot, context: EstimatePdfContext): Buffer {
  const doc = new PdfDocument(`Estimate ${snapshot.quote.quoteNumber}`);
  let page = doc.addPage();
  let y = M;
  const brand = context.branding ?? {};
  // Kyle, Video 6: the business decides what an estimate shows.
  const showUnitPrices = brand.showUnitPrices !== false;
  const showDescriptions = brand.showServiceDescriptions !== false;
  const footerLines = brand.footer?.trim() ? wrapText(brand.footer.trim(), "regular", 7.5, RIGHT - M).slice(0, 3) : [];
  const bottom = BOTTOM - footerLines.length * 10;

  const tableHeader = () => {
    page.rect(M, y, RIGHT - M, 22, SHADE);
    page.text(M + 8, y + 6, "SERVICE", { font: "bold", size: 8, color: MUTED });
    if (showUnitPrices) {
      page.text(COL.qty, y + 6, "QTY", { font: "bold", size: 8, color: MUTED, align: "right" });
      page.text(COL.price, y + 6, "PRICE", { font: "bold", size: 8, color: MUTED, align: "right" });
    }
    page.text(COL.amount - 8, y + 6, "AMOUNT", { font: "bold", size: 8, color: MUTED, align: "right" });
    y += 28;
  };
  /** Starts a new page when `height` more points would not fit; repeats the table header when asked. */
  const room = (height: number, withHeader = false) => {
    if (y + height <= bottom) return;
    page = doc.addPage();
    y = M;
    if (withHeader) tableHeader();
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  // The logo at its own proportions, at most 180 × 56; the business beside or under it.
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
  page.text(RIGHT, headerTop - 2, context.draft ? "DRAFT ESTIMATE" : "ESTIMATE", { font: "bold", size: 20, color: context.draft ? [180, 83, 9] : INK, align: "right" });
  // The estimate's facts sit under the title, and the page carries on under whichever is longer.
  const leftBottom = y;
  y = headerTop + 30;
  const facts: Array<[string, string]> = [
    ["Estimate", snapshot.quote.quoteNumber + (context.revisionNumber && context.revisionNumber > 1 ? ` (revision ${context.revisionNumber})` : "")],
    ["Date", chicagoDate(context.date)],
  ];
  if (snapshot.quote.validUntil) facts.push(["Valid until", dateOnly(snapshot.quote.validUntil)]);
  for (const [label, value] of facts) {
    // The label sits just left of its value, however long the value is.
    page.text(RIGHT - textWidth(value, "bold", 9) - 10, y, label, { size: 9, color: MUTED, align: "right" });
    page.text(RIGHT, y, value, { font: "bold", size: 9, align: "right" });
    y += 14;
  }
  y = Math.max(y, leftBottom);
  if (context.draft) {
    page.text(M, y, "Not yet finalized: this is not what the customer has been sent.", { size: 8, color: [180, 83, 9] });
    y += 12;
  }
  y += 10;

  // ── Prepared for ───────────────────────────────────────────────────────────
  page.text(M, y, "PREPARED FOR", { font: "bold", size: 8, color: MUTED });
  y += 13;
  if (context.customerName) { page.text(M, y, context.customerName, { font: "bold", size: 11 }); y += 15; }
  for (const contact of [context.customerEmail, context.customerPhone && phoneText(context.customerPhone)].filter(Boolean) as string[]) {
    page.text(M, y, contact, { size: 9, color: MUTED }); y += 12;
  }
  if (snapshot.locations.length === 1) {
    const l = snapshot.locations[0];
    page.text(M, y, `${placeName(l) ? `${placeName(l)} — ` : ""}${placeLine(l)}`, { size: 9, color: MUTED }); y += 12;
  }
  y += 14;

  // ── Services ───────────────────────────────────────────────────────────────
  tableHeader();
  const groups = snapshot.locations.length > 1
    ? snapshot.locations.map((l) => ({ location: l, lines: snapshot.lineItems.filter((line) => line.propertyId === l.id) }))
      .concat([{ location: null as never, lines: snapshot.lineItems.filter((line) => !snapshot.locations.some((l) => l.id === line.propertyId)) }])
      .filter((g) => g.lines.length)
    : [{ location: null, lines: snapshot.lineItems }];
  for (const group of groups) {
    if (group.location) {
      room(40, true);
      const heading = placeName(group.location) ?? group.location.address;
      page.text(M + 8, y, heading, { font: "bold", size: 10, color: GREEN });
      page.text(M + 8 + textWidth(heading, "bold", 10) + 8, y + 1, placeLine(group.location), { size: 8, color: MUTED });
      y += 18;
    }
    for (const line of group.lines) {
      const title = wrapText(line.description || "Service", "bold", 10, DESC_WIDTH);
      const notes = showDescriptions && line.serviceNotes ? wrapText(line.serviceNotes, "regular", 8.5, DESC_WIDTH) : [];
      const height = title.length * 13 + notes.length * 11 + 10;
      room(height, true);
      const top = y;
      for (const t of title) { page.text(M + 8, y, t, { font: "bold", size: 10 }); y += 13; }
      for (const n of notes) { page.text(M + 8, y, n, { size: 8.5, color: MUTED }); y += 11; }
      const pending = line.unitPrice == null;
      if (showUnitPrices) {
        page.text(COL.qty, top, quantity(Number(line.quantity)), { size: 10, align: "right" });
        page.text(COL.price, top, pending ? "To be quoted" : money(Number(line.unitPrice)), { size: 10, align: "right", color: pending ? MUTED : INK });
      }
      page.text(COL.amount - 8, top, pending ? (showUnitPrices ? "—" : "To be quoted") : money(Number(line.totalPrice)), { font: pending && !showUnitPrices ? "regular" : "bold", size: 10, align: "right", color: pending && !showUnitPrices ? MUTED : INK });
      y += 6;
      page.line(M, y, RIGHT, y);
      y += 8;
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totals = estimatePdfTotals(snapshot);
  const rows: Array<[string, string, [number, number, number]?]> = [["Subtotal", money(totals.subtotal)]];
  for (const d of totals.discounts) {
    rows.push([`${d.name} (${d.kind === "percent" ? `${d.value}%` : money(d.value)})`, `–${money(d.amount)}`, GREEN]);
  }
  if (totals.tax > 0) rows.push([`Sales tax${snapshot.tax?.label ? ` (${snapshot.tax.label})` : ""}`, money(totals.tax)]);
  room(rows.length * 16 + 40);
  y += 4;
  const labelX = RIGHT - 230;
  for (const [label, value, color] of rows) {
    const labelLines = wrapText(label, "regular", 9.5, 150);
    labelLines.forEach((l, i) => page.text(labelX, y + i * 12, l, { size: 9.5, color: color ?? MUTED }));
    page.text(RIGHT - 8, y, value, { size: 10, align: "right", color: color ?? INK });
    y += Math.max(16, labelLines.length * 12 + 4);
  }
  page.line(labelX, y, RIGHT, y, [148, 163, 184], 1);
  y += 8;
  page.text(labelX, y + 2, "Total", { font: "bold", size: 12 });
  page.text(RIGHT - 8, y, money(totals.total), { font: "bold", size: 15, align: "right" });
  y += 30;
  if (snapshot.lineItems.some((l) => l.unitPrice == null)) {
    room(16);
    page.text(M, y, "Services marked “to be quoted” are priced separately and are not in this total.", { size: 8.5, color: MUTED });
    y += 18;
  }

  // ── Notes and terms ────────────────────────────────────────────────────────
  for (const [heading, body] of [["NOTES", snapshot.quote.notes], ["TERMS", snapshot.quote.terms]] as const) {
    if (!body?.trim()) continue;
    room(40);
    page.text(M, y, heading, { font: "bold", size: 8, color: MUTED });
    y += 13;
    for (const l of wrapText(body.trim(), "regular", 9, RIGHT - M)) {
      room(12);
      page.text(M, y, l, { size: 9 });
      y += 12;
    }
    y += 12;
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  doc.pages.forEach((p: PdfPage, i) => {
    // The business's own footer (licence, insurance …) above the page line.
    footerLines.forEach((line, n) => p.text(M, 792 - 50 - (footerLines.length - n) * 10, line, { size: 7.5, color: MUTED }));
    p.line(M, 792 - 44, RIGHT, 792 - 44);
    p.text(M, 792 - 38, `${context.businessName} · Estimate ${snapshot.quote.quoteNumber}`, { size: 8, color: MUTED });
    p.text(RIGHT, 792 - 38, `Page ${i + 1} of ${doc.pages.length}`, { size: 8, color: MUTED, align: "right" });
  });
  return doc.toBuffer();
}
