import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PdfDocument, textWidth, wrapText } from "./pdf-writer.ts";
import { estimatePdfTotals, renderEstimatePdf, type EstimatePdfSnapshot } from "./estimate-pdf.ts";
import { reachesEstimate, recipientsOf, renderEstimateEmail, type EstimateEmailValues } from "./estimate-email.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the PDF writer", () => {
  it("measures with Helvetica's own widths", () => {
    assert.equal(textWidth("Hi", "regular", 10), 9.44); // H 722 + i 222
    assert.equal(textWidth("Hi", "bold", 10), 10); // H 722 + i 278
  });

  it("wraps at spaces, and cuts a word longer than a line", () => {
    assert.deepEqual(wrapText("one two three", "regular", 10, textWidth("one two", "regular", 10)), ["one two", "three"]);
    assert.ok(wrapText("x".repeat(200), "regular", 10, 100).every((line) => textWidth(line, "regular", 10) <= 100));
  });

  it("writes a well-formed PDF whose cross-reference points at every object", () => {
    const doc = new PdfDocument("T (1)");
    doc.addPage().text(10, 10, "Price (USD) \\ – café 中");
    const pdf = doc.toBuffer().toString("latin1");
    assert.ok(pdf.startsWith("%PDF-1.4") && pdf.trimEnd().endsWith("%%EOF"));
    assert.match(pdf, /\(Price \\\(USD\\\) \\\\ \\226 caf\\351 \?\) Tj/); // escaped; WinAnsi; unknown → "?"
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    assert.ok(pdf.slice(xref).startsWith("xref"));
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => assert.ok(pdf.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  });
});

const snapshot: EstimatePdfSnapshot = {
  quote: { quoteNumber: "Q-7", notes: "Dog inside, please.", terms: null, validUntil: "2026-11-26" },
  lineItems: [
    { description: "Exterior windows", quantity: 1, unitPrice: 300, totalPrice: 300, propertyId: 1, taxable: false },
    { description: "Screens (materials)", quantity: 4, unitPrice: 50, totalPrice: 200, propertyId: 1, taxable: true },
    { description: "Stain removal", quantity: 1, unitPrice: null, totalPrice: 0, propertyId: 1 },
  ],
  locations: [{ id: 1, name: "Primary service property", address: "11 Cedar St", city: "Kansas City", state: "MO", zip: "64111" }],
  discounts: [{ name: "Senior", kind: "percent", value: 10 }],
  tax: { rate: 5.475, label: "Missouri 4.225% + Jackson County 1.25%" },
};
const context = { businessName: "Superior", customerName: "Lute Atieh", customerPhone: "8165550177", date: new Date("2026-10-27T15:00:00Z") };

// Kyle's answer #5: the PDF is the estimate the customer reads.
describe("the estimate PDF", () => {
  it("adds up exactly as the estimate does: discounts, then tax on taxable lines", () => {
    const totals = estimatePdfTotals(snapshot);
    assert.deepEqual([totals.subtotal, totals.discountTotal, totals.tax, totals.total], [500, 50, 9.86, 459.86]);
  });

  it("shows the totals, the discount, the tax, and a to-be-quoted line without $0", () => {
    const pdf = renderEstimatePdf(snapshot, context).toString("latin1");
    for (const text of ["($459.86)", "(Senior \\(10%\\))", "(\\226$50.00)", "(To be quoted)", "($9.86)", "(\\(816\\) 555-0177)"]) {
      assert.ok(pdf.includes(text), text);
    }
    assert.ok(!pdf.includes("Primary service property"), "the generic location name is left out");
    assert.ok(!pdf.includes("DRAFT"));
  });

  it("marks a draft as one", () => {
    assert.ok(renderEstimatePdf(snapshot, { ...context, draft: true }).toString("latin1").includes("(DRAFT ESTIMATE)"));
  });

  it("runs onto more pages, numbered, when the services do", () => {
    const many = { ...snapshot, lineItems: Array.from({ length: 40 }, (_, i) => ({ description: `Window ${i + 1}`, quantity: 1, unitPrice: 10, totalPrice: 10, propertyId: 1 })) };
    const pdf = renderEstimatePdf(many, context).toString("latin1");
    assert.ok(pdf.includes("(Page 1 of 3)") && pdf.includes("(Page 3 of 3)"), "three numbered pages");
  });
});

const values: EstimateEmailValues = {
  estimateLink: "https://x/api/public/estimates/t/pdf", estimatePageLink: "https://x/estimate/t", firstName: "Lute <b>",
  customerName: "Lute Atieh", estimateNumber: "Q-7", estimateTotal: "$459.86", validUntil: "November 26, 2026",
  businessName: "Superior", senderName: "Team Admin",
};

describe("the estimate email", () => {
  it("fills the tags; what a customer typed is escaped in the message, not in the subject", () => {
    const out = renderEstimateEmail("Estimate {{estimate_number}} for {{first_name}}", '<p>Hi {{first_name}}: <a href="{{estimate_link}}">PDF</a> {{unknown}}</p>', values);
    assert.equal(out.subject, "Estimate Q-7 for Lute <b>");
    assert.match(out.bodyHtml, /Hi Lute &lt;b&gt;: <a href="https:\/\/x\/api\/public\/estimates\/t\/pdf">PDF<\/a> \{\{unknown\}\}/);
    assert.match(out.bodyHtml, /^<div style="font-family:Arial/);
  });

  it("must give the customer the estimate: a link tag, or the PDF attached", () => {
    assert.equal(reachesEstimate("<p>Hello</p>", false), false);
    assert.equal(reachesEstimate("<p>{{estimate_page_link}}</p>", false), true);
    assert.equal(reachesEstimate("<p>Hello</p>", true), true);
  });

  it("one to ten real addresses, each once", () => {
    assert.deepEqual(recipientsOf(["A@x.com", "a@x.com", " b@y.org "]), { recipients: ["a@x.com", "b@y.org"] });
    assert.ok("error" in recipientsOf([]));
    assert.ok("error" in recipientsOf(["nope"]));
    assert.ok("error" in recipientsOf(Array.from({ length: 11 }, (_, i) => `p${i}@x.com`)));
  });
});

describe("the wiring", () => {
  const route = read("../routes/estimate-email.ts");

  it("only the profile's own addresses; a new one is saved to the profile first", () => {
    assert.match(route, /code: "recipient_not_on_profile"/);
  });

  it("each address passes the same communication safety as any email", () => {
    assert.match(route, /evaluateRecipientEligibility\(tx, \{\s*customerId: quote\.customerId, channel: "email", rawDestination: email/);
  });

  it("nothing unpriced, nothing unfinalized, and one email per click", () => {
    assert.match(route, /code: "estimate_unpriced"/);
    assert.match(route, /Finalize the estimate before sending/);
    assert.match(route, /if \(claim\.kind === "replay"\) \{ markIdempotencyReplay\(res\); res\.json\(\{ status: "already_sent" \}\); return; \}/);
  });

  it("every email is in the profile's history, and the estimate's delivery says how it went", () => {
    assert.match(route, /sentBy: senderName\(req\)/);
    assert.match(route, /set\(\{ status: result\.success \? "sent" : "failed"/);
  });

  it("the customer's PDF sits behind the same link guard as their page; the office's behind sign-in", () => {
    const estimates = read("../routes/estimates.ts");
    assert.match(estimates, /router\.get\("\/public\/estimates\/:token\/pdf"/);
    assert.match(estimates, /router\.use\("\/public\/estimates\/:token"/);
    assert.match(estimates, /router\.get\("\/quotes\/:id\/pdf"/);
  });

  it("the old deliver action and the email make the link the same way", () => {
    assert.match(read("../routes/estimates.ts"), /const created = await createEstimateLinkTx\(tx, \{/);
    assert.match(route, /createEstimateLinkTx\(tx, \{/);
  });
});
