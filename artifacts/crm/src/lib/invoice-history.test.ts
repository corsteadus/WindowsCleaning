// A3 (Kyle, Video 7): the invoice's history, its email, and the customer's page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { describeInvoiceActivity } from "./invoice-history.ts";
import { DEFAULT_INVOICE_TEXT, invoiceTextToHtml, reachesInvoice } from "./invoice-email.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const deliveries = [{ id: 5, publicLinkId: 9, channel: "email", recipient: "ann@example.com" }];
const at = "2026-10-29T14:00:00Z";

test("the invoice's history says who sent it where, and which address opened it", () => {
  const sent = describeInvoiceActivity({ id: 1, occurredAt: at, activityType: "invoice_sent", actorType: "staff", actorId: "u1", publicLinkId: 9, detail: { attachPdf: true } },
    { actors: { u1: "Lute Atieh" }, deliveries });
  assert.equal(sent.title, "Emailed the invoice");
  assert.equal(sent.detail, "to ann@example.com with the PDF attached");
  assert.equal(sent.who, "Lute Atieh");
  const opened = describeInvoiceActivity({ id: 2, occurredAt: at, activityType: "opened", actorType: "customer", detail: { deliveryRequestId: 5, via: "page", openCount: 2 } }, { deliveries });
  assert.equal(opened.title, "Opened the invoice");
  assert.equal(opened.detail, "through the link sent to ann@example.com (visit 2)");
  assert.equal(describeInvoiceActivity({ id: 3, occurredAt: at, activityType: "printed", actorType: "customer" }).title, "Printed or saved it as a PDF");
});

test("the invoice email starts with a link to the customer's page", () => {
  assert.match(DEFAULT_INVOICE_TEXT, /\{\{invoice_page_link\}\}/);
  assert.match(invoiceTextToHtml("See {{invoice_page_link}} <now>"), /<a href="\{\{invoice_page_link\}\}">View your invoice<\/a> &lt;now&gt;/);
  assert.equal(reachesInvoice("nothing", false), false);
  assert.equal(reachesInvoice("nothing", true), true);
});

test("the customer's invoice page needs no sign-in and passes its key on", () => {
  assert.match(read("../App.tsx"), /<Route path="\/invoice\/:token" component=\{PublicInvoice\} \/>/);
  const page = read("../pages/PublicInvoice.tsx");
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\("r"\)/);
  assert.match(page, /fetch\(keyed\(`\$\{BASE\}\/api\/public\/invoices\/\$\{encodeURIComponent\(token\)\}`\)\)/);
  assert.match(page, /href=\{keyed\(`\$\{BASE\}\/api\/public\/invoices\/\$\{encodeURIComponent\(token\)\}\/pdf`\)\}/);
});

test("the invoice page: PDF, copy the customer's link, email it, and see the history", () => {
  const detail = read("../pages/InvoiceDetail.tsx");
  assert.match(detail, /data-testid="invoice-pdf"/);
  assert.match(detail, /\/api\/invoices\/\$\{invoiceId\}\/customer-link/);
  assert.match(detail, /describeInvoiceActivity\(item, \{ actors: history\.data!\.actors, deliveries \}\)/);
  assert.match(detail, /data-testid="invoice-delivery-opens"[^>]*>\{openSummary\(item\)\}/);
});
