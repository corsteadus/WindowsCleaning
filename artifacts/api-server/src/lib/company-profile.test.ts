import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { contactLines, formatPhone, jpegSize, logoOf, profileOf } from "./company-profile-rules.ts";
import { renderEstimatePdf, type EstimatePdfSnapshot } from "./estimate-pdf.ts";
import { renderEstimateEmail } from "./estimate-email.ts";
import { companyProfileV1Migration } from "../migrations/company-profile-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** The smallest JPEG header that carries a size: SOI, then a baseline frame (SOF0). */
function fakeJpeg(width: number, height: number, extra = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), sof, Buffer.alloc(extra), Buffer.from([0xff, 0xd9])]);
}

// Kyle, Video 6: the business's own name, details and logo on its estimates.
describe("the company profile", () => {
  it("text is trimmed and bounded; an email must be one", () => {
    const ok = profileOf({ businessName: "  Superior  ", email: "office@x.com", showUnitPrices: false });
    assert.ok("profile" in ok && ok.profile.businessName === "Superior" && ok.profile.showUnitPrices === false && ok.profile.showServiceDescriptions === true);
    assert.ok("error" in profileOf({ email: "nope" }));
    assert.ok("error" in profileOf({ estimateFooter: "x".repeat(1001) }));
    assert.ok("error" in profileOf({ showUnitPrices: "no" }));
  });

  it("contact lines: the address, then phone · email · website, the phone formatted", () => {
    assert.deepEqual(contactLines({ address: "123 Main St", city: "Kansas City", state: "MO", zip: "64111", phone: "8165550100", email: "o@x.com", website: null }),
      ["123 Main St, Kansas City, MO 64111", "(816) 555-0100 · o@x.com"]);
    assert.deepEqual(contactLines({ address: null, city: null, state: null, zip: null, phone: null, email: null, website: null }), []);
    assert.equal(formatPhone("+44 20 7946 0000"), "+44 20 7946 0000");
  });

  it("a logo is a real JPEG, its size read from the file, at most 500 KB", () => {
    assert.deepEqual(jpegSize(fakeJpeg(600, 200)), { width: 600, height: 200 });
    assert.equal(jpegSize(Buffer.from("\x89PNG....", "latin1")), null);
    const ok = logoOf(`data:image/jpeg;base64,${fakeJpeg(600, 200).toString("base64")}`);
    assert.ok("jpeg" in ok && ok.width === 600 && ok.height === 200);
    assert.ok("error" in logoOf("data:image/jpeg;base64,iVBORw0KGgo="));
    assert.ok("error" in logoOf(fakeJpeg(600, 200, 520 * 1024).toString("base64")));
  });
});

const snapshot: EstimatePdfSnapshot = {
  quote: { quoteNumber: "Q-8", notes: null, terms: null, validUntil: null },
  lineItems: [{ description: "Windows", quantity: 2, unitPrice: 150, totalPrice: 300, serviceNotes: "Both stories" }],
  locations: [],
};

describe("branding on the estimate", () => {
  it("the PDF carries the logo, the contact lines and the footer", () => {
    const pdf = renderEstimatePdf(snapshot, {
      businessName: "Superior", customerName: "Lute", date: new Date("2026-10-27T15:00:00Z"),
      branding: { contactLines: ["123 Main St"], logo: { jpeg: fakeJpeg(600, 200), width: 600, height: 200 }, footer: "Licence #ZZ-1" },
    }).toString("latin1");
    assert.match(pdf, /\/Subtype \/Image \/Width 600 \/Height 200 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);
    assert.match(pdf, /\/XObject << \/Im1 \d+ 0 R >>/);
    assert.ok(pdf.includes("(123 Main St)") && pdf.includes("(Licence #ZZ-1)"));
  });

  it("the business decides whether unit prices and descriptions show", () => {
    const hidden = renderEstimatePdf(snapshot, { businessName: "S", customerName: null, date: new Date(), branding: { showUnitPrices: false, showServiceDescriptions: false } }).toString("latin1");
    assert.ok(!hidden.includes("(QTY)") && !hidden.includes("($150.00)") && !hidden.includes("(Both stories)"));
    assert.ok(hidden.includes("($300.00)"));
    const shown = renderEstimatePdf(snapshot, { businessName: "S", customerName: null, date: new Date() }).toString("latin1");
    assert.ok(shown.includes("(QTY)") && shown.includes("($150.00)") && shown.includes("(Both stories)"));
  });

  it("the estimate email shows the logo at the top", () => {
    const out = renderEstimateEmail("S", "<p>Hi</p>", {
      estimateLink: "l", estimatePageLink: "p", firstName: "L", customerName: "L", estimateNumber: "Q", estimateTotal: "$1",
      validUntil: "", businessName: "Superior & Co", senderName: "T", logoUrl: "https://x/api/public/branding/logo.jpg",
    });
    assert.match(out.bodyHtml, /<p><img src="https:\/\/x\/api\/public\/branding\/logo\.jpg" alt="Superior &amp; Co"/);
  });
});

describe("the wiring", () => {
  it("everyone signed in reads it; only an administrator changes it; the logo and name are public", () => {
    const auth = read("./authorization.ts");
    assert.match(auth, /\{ prefix: "\/company-profile", methods: \["GET"\], capability: "quotes\.view" \}/);
    assert.match(auth, /\{ prefix: "\/company-profile", capability: "admin\.settings" \}/);
    assert.match(auth, /req\.path === "\/public\/branding" \|\| req\.path === "\/public\/branding\/logo\.jpg"/);
  });

  it("every estimate PDF and email is branded from the profile", () => {
    assert.match(read("../routes/estimates.ts"), /\.\.\.\(await estimateBranding\(\)\),/);
    assert.match(read("../routes/estimate-email.ts"), /\.\.\.\(await estimateBranding\(\)\), customerName:/);
  });

  it("the migration only creates the new table, and is registered", async () => {
    const calls: string[] = [];
    let exists = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.tables")) return { rows: [{ count: exists }] };
      if (text.startsWith("CREATE TABLE company_profile")) exists = 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await companyProfileV1Migration.preflight(context);
    await companyProfileV1Migration.apply(context, pre);
    await companyProfileV1Migration.verify(context);
    assert.ok(!calls.some((call) => /UPDATE |DELETE FROM|ALTER TABLE/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(companyProfileV1Migration as never));
  });
});
