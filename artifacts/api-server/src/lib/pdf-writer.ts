/**
 * A small PDF writer — phase 7, Kyle's answer #5: "a link that opens the estimate
 * as a PDF is the standard; attaching the PDF is an option." No dependency: the
 * estimate needs text, lines and shaded boxes in the standard Helvetica fonts,
 * which every PDF reader carries, so nothing is embedded and files stay small.
 *
 * Text is WinAnsi-encoded; widths are Helvetica's own (Adobe AFM), so text can be
 * measured, right-aligned and wrapped exactly. A character outside WinAnsi is
 * written as "?".
 */
export type FontName = "regular" | "bold";

// Adobe AFM widths for WinAnsi 32–126, in 1/1000 em.
const REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// The few non-ASCII characters an estimate uses, as WinAnsi codes and widths [regular, bold].
const EXTRA: Record<string, [code: number, regular: number, bold: number]> = {
  "–": [150, 556, 556], "—": [151, 1000, 1000], "‘": [145, 222, 278], "’": [146, 222, 278],
  "“": [147, 333, 500], "”": [148, 333, 500], "•": [149, 350, 350], "×": [215, 584, 584],
  "·": [183, 278, 278], "…": [133, 1000, 1000], " ": [160, 278, 278], "é": [233, 556, 556],
  "è": [232, 556, 556], "ñ": [241, 556, 611], "ü": [252, 556, 611], "°": [176, 400, 400],
};

/** A character as its WinAnsi byte and width (1/1000 em). */
function glyph(ch: string, font: FontName): [number, number] {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return [code, (font === "bold" ? BOLD : REGULAR)[code - 32]];
  const extra = EXTRA[ch];
  if (extra) return [extra[0], font === "bold" ? extra[2] : extra[1]];
  if (ch === "\t") return [32, 278];
  return [63, font === "bold" ? 611 : 556]; // "?"
}

export function textWidth(text: string, font: FontName, size: number): number {
  let units = 0;
  for (const ch of text) units += glyph(ch, font)[1];
  return (units * size) / 1000;
}

/** Lines of at most `width` points, broken at spaces (a word longer than a line is cut). */
export function wrapText(text: string, font: FontName, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= width) { line = candidate; continue; }
      if (line) out.push(line);
      let rest = word;
      while (textWidth(rest, font, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), font, size) > width) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

const pdfString = (text: string, font: FontName) => {
  const bytes: number[] = [];
  for (const ch of text) bytes.push(glyph(ch, font)[0]);
  let out = "";
  for (const b of bytes) {
    if (b === 40 || b === 41 || b === 92) out += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
};
const num = (n: number) => (Math.round(n * 100) / 100).toString();
type RGB = [number, number, number];
const rgb = (c: RGB) => c.map((v) => num(v / 255)).join(" ");

/** One page's drawing. Coordinates are from the top-left, in points (1/72 in). */
export class PdfPage {
  readonly ops: string[] = [];
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  text(x: number, top: number, text: string, opts: { font?: FontName; size?: number; color?: RGB; align?: "left" | "right" | "center" } = {}) {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 10;
    const w = textWidth(text, font, size);
    const left = opts.align === "right" ? x - w : opts.align === "center" ? x - w / 2 : x;
    const baseline = this.height - top - size * 0.8;
    this.ops.push(`BT /${font === "bold" ? "F2" : "F1"} ${num(size)} Tf ${rgb(opts.color ?? [15, 23, 42])} rg ${num(left)} ${num(baseline)} Td ${pdfString(text, font)} Tj ET`);
  }

  line(x1: number, top1: number, x2: number, top2: number, color: RGB = [226, 232, 240], width = 0.75) {
    this.ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.height - top1)} m ${num(x2)} ${num(this.height - top2)} l S`);
  }

  rect(x: number, top: number, w: number, h: number, fill: RGB) {
    this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(this.height - top - h)} ${num(w)} ${num(h)} re f`);
  }

  /** An image added to the document with addJpeg, drawn into this box. */
  image(name: string, x: number, top: number, w: number, h: number) {
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.height - top - h)} cm /${name} Do Q`);
  }
}

/** A document of US Letter pages. */
export class PdfDocument {
  readonly pages: PdfPage[] = [];
  readonly images: Array<{ name: string; jpeg: Buffer; width: number; height: number; grey: boolean }> = [];
  readonly title: string;
  readonly width: number;
  readonly height: number;
  constructor(title: string, width = 612, height = 792) {
    this.title = title;
    this.width = width;
    this.height = height;
  }

  /** A JPEG (baseline or progressive, RGB or grey) for page.image(name, …). */
  addJpeg(jpeg: Buffer, width: number, height: number, grey = false): string {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, jpeg, width, height, grey });
    return name;
  }

  addPage(): PdfPage {
    const page = new PdfPage(this.width, this.height);
    this.pages.push(page);
    return page;
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const add = (body: string) => { objects.push(body); return objects.length; };
    const catalog = add("");
    const pagesObj = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageIds = this.images.map((img) => {
      const head = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.grey ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`;
      return { name: img.name, id: add(`${head}${img.jpeg.toString("latin1")}\nendstream`) };
    });
    const xobjects = imageIds.length ? ` /XObject << ${imageIds.map((i) => `/${i.name} ${i.id} 0 R`).join(" ")} >>` : "";
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const content = page.ops.join("\n");
      const stream = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobjects} >> /Contents ${stream} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const info = add(`<< /Title ${pdfString(this.title, "regular")} /Producer (Corstead) >>`);

    let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
