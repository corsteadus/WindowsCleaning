/**
 * A printed letter — A5 (Kyle, Video 8): "make a letter … as a template, and it
 * will plug all that customer's information into the letter." The business's
 * letterhead, the date, the customer's mailing address where a window envelope
 * shows it, an optional "Re:" line, then the letter. Several customers print as
 * one PDF, each letter starting on its own page. Pure: no database.
 */
import { PdfDocument, wrapText, type PdfPage } from "./pdf-writer.ts";

export interface LetterBranding {
  businessName: string;
  contactLines: string[];
  logo: { jpeg: Buffer; width: number; height: number } | null;
}

export interface LetterContent {
  /** "October 29, 2026". */
  date: string;
  /** Name, street, City, ST ZIP; blank lines are dropped. */
  recipientLines: string[];
  subject: string | null;
  body: string;
}

const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const RULE: [number, number, number] = [203, 213, 225];
const M = 72;
const RIGHT = 612 - M;
const WIDTH = RIGHT - M;
const BOTTOM = 792 - 64;
const SIZE = 11;
const LEADING = 15.5;
export const MAX_LETTERS_PER_PDF = 200;

export function letterPdfFilename(name: string, today: string): string {
  const safe = name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "letter";
  return `Letter-${safe}-${today}.pdf`;
}

function letterhead(doc: PdfDocument, page: PdfPage, brand: LetterBranding): number {
  let y = 48;
  if (brand.logo) {
    const scale = Math.min(180 / brand.logo.width, 52 / brand.logo.height, 1);
    page.image(doc.addJpeg(brand.logo.jpeg, brand.logo.width, brand.logo.height), M, y, brand.logo.width * scale, brand.logo.height * scale);
    y += brand.logo.height * scale + 8;
  }
  page.text(M, y, brand.businessName, { font: "bold", size: brand.logo ? 12 : 15, color: INK });
  y += brand.logo ? 15 : 19;
  for (const line of brand.contactLines.slice(0, 2)) {
    page.text(M, y, line, { size: 8.5, color: MUTED });
    y += 11;
  }
  y += 6;
  page.line(M, y, RIGHT, y, RULE, 0.75);
  return y + 26;
}

export function renderLetterPdf(letters: LetterContent[], brand: LetterBranding, title = "Letter"): Buffer {
  if (!letters.length) throw new Error("There is no letter to print");
  if (letters.length > MAX_LETTERS_PER_PDF) throw new Error(`Print at most ${MAX_LETTERS_PER_PDF} letters at once`);
  const doc = new PdfDocument(title);
  for (const letter of letters) {
    let page = doc.addPage();
    let y = letterhead(doc, page, brand);
    const room = () => {
      if (y + LEADING <= BOTTOM) return;
      page = doc.addPage();
      y = 56;
    };

    page.text(M, y, letter.date, { size: SIZE, color: INK });
    y += LEADING * 2;
    for (const line of letter.recipientLines.map((l) => l.trim()).filter(Boolean).slice(0, 6)) {
      page.text(M, y, line, { size: SIZE, color: INK });
      y += LEADING;
    }
    y += LEADING;
    if (letter.subject?.trim()) {
      for (const line of wrapText(`Re: ${letter.subject.trim()}`, "bold", SIZE, WIDTH)) {
        page.text(M, y, line, { font: "bold", size: SIZE, color: INK });
        y += LEADING;
      }
      y += LEADING * 0.5;
    }
    const paragraphs = letter.body.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
    for (const paragraph of paragraphs) {
      for (const sourceLine of paragraph.split("\n")) {
        const wrapped = sourceLine.trim() ? wrapText(sourceLine, "regular", SIZE, WIDTH) : [""];
        for (const line of wrapped) {
          room();
          page.text(M, y, line, { size: SIZE, color: INK });
          y += LEADING;
        }
      }
      y += LEADING * 0.6;
    }
  }
  return doc.toBuffer();
}
