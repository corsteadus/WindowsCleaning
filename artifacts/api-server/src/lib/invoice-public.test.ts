// A3 (Kyle, Video 7): the customer's invoice page and PDF, emailed per address, opens counted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { invoicePdfFilename, invoiceStanding, renderInvoicePdf, viewLines, type InvoiceView } from "./invoice-document.ts";
import { reachesInvoice, renderInvoiceEmail } from "./invoice-email.ts";
import { officeInvoiceOpenedNotice } from "./estimate-accepted-notice.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const view: InvoiceView = {
  invoiceNumber: "INV-7", status: "sent", issuedAt: "2026-10-01T15:00:00Z", dueDate: "2026-10-31", paidAt: null,
  customerName: "Ann Lee", customerEmail: "ann@example.com", customerPhone: null, serviceAddress: "12 Cedar St, Kansas City, MO 64111",
  lines: viewLines([{ description: "Exterior windows", quantity: "1", unitPrice: "300", discountAmount: "0", taxAmount: "0", lineTotal: "300" }], 300),
  subtotal: 300, taxAmount: 0, totalAmount: 300, amountPaid: 100, credited: 0, balanceDue: 200,
};

test("where the invoice stands for the customer", () => {
  assert.equal(invoiceStanding(view, "2026-10-29"), "due");
  assert.equal(invoiceStanding(view, "2026-11-01"), "overdue", "past its due date");
  assert.equal(invoiceStanding({ ...view, balanceDue: 0 }, "2026-11-01"), "paid", "nothing owed is paid, whatever the date");
  assert.equal(invoiceStanding({ ...view, status: "voided" }, "2026-10-29"), "voided");
  assert.equal(invoiceStanding({ ...view, status: "credited", balanceDue: 0 }, "2026-10-29"), "credited");
});

test("an invoice from before invoices had lines is one line for its subtotal", () => {
  assert.deepEqual(viewLines([], 85), [{ description: "Services", quantity: 1, unitPrice: 85, discountAmount: 0, taxAmount: 0, lineTotal: 85 }]);
});

test("the PDF is a real PDF, says INVOICE and what is still owed", () => {
  const pdf = renderInvoicePdf(view, { businessName: "Superior", today: "2026-10-29" }).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\(INVOICE\)/);
  assert.match(pdf, /\(Balance due\)/);
  assert.match(pdf, /\(\$200\.00\)/);
  assert.doesNotMatch(pdf, /\(PAID\)/);
  assert.match(renderInvoicePdf({ ...view, balanceDue: 0, amountPaid: 300, status: "paid" }, { businessName: "S", today: "2026-10-29" }).toString("latin1"), /\(PAID\)/);
  assert.equal(invoicePdfFilename("INV 7/a"), "Invoice-INV7a.pdf");
});

test("the email fills its tags, escaped, and must reach the invoice", () => {
  const out = renderInvoiceEmail("Invoice {{invoice_number}}", "<p>Hi {{first_name}}, {{balance_due}} <a href=\"{{invoice_page_link}}\">x</a></p>", {
    invoiceLink: "https://x/pdf", invoicePageLink: "https://x/invoice/T?r=K", firstName: "<b>Ann</b>", customerName: "Ann", invoiceNumber: "INV-7",
    invoiceTotal: "$300.00", balanceDue: "$200.00", dueDate: "October 31, 2026", businessName: "S", senderName: "Lute",
  });
  assert.equal(out.subject, "Invoice INV-7");
  assert.match(out.bodyHtml, /&lt;b&gt;Ann&lt;\/b&gt;, \$200\.00 <a href="https:\/\/x\/invoice\/T\?r=K">/);
  assert.equal(reachesInvoice("no link", false), false);
  assert.equal(reachesInvoice("{{invoice_link}}", false), true);
  assert.equal(reachesInvoice("no link", true), true);
});

test("the office's notice says who, which address, and what is owed", () => {
  const notice = officeInvoiceOpenedNotice({ invoiceNumber: "INV-7", customerName: "Ann Lee", recipient: "ann@example.com", openCount: 1, balanceDue: "$200.00" });
  assert.equal(notice.subject, "INV-7 opened by Ann Lee");
  assert.match(notice.text, /Ann Lee opened invoice INV-7 for the first time, through the link sent to ann@example\.com\.\n\n\$200\.00 is still due\./);
});

test("the customer's page: no sign-in, its token alone, never the office's notes or contact details", () => {
  assert.match(read("./authorization.ts"), /req\.path\.startsWith\("\/public\/invoices\/"\)/);
  const routes = read("../routes/invoice-public.ts");
  assert.match(routes, /const \{ customerEmail: _email, customerPhone: _phone, \.\.\.view \} = found\.view;/);
  assert.doesNotMatch(read("./invoice-document.ts"), /notes: string/);
  assert.ok(read("../app.ts").includes('(estimates|invoices)\\/[^/]+/, "/public/$1/[redacted]"'), "invoice tokens are kept out of the logs");
});

test("opens follow the estimate's rules: staff not counted, locked, no notice once settled", () => {
  const routes = read("../routes/invoice-public.ts");
  const body = routes.slice(routes.indexOf("async function recordOpen"), routes.indexOf("router.get(\"/public/invoices/:token\""));
  assert.match(body, /if \(req\.isAuthenticated\(\)\) return;/);
  assert.match(body, /\.for\("update"\)/);
  assert.match(body, /if \(settled \|\| !openNoticeDue\(lastNotified, now\)\) return null;/);
  assert.match(body, /openNotificationEnabled/);
});

test("emailing: one per click, each address its own link, a draft becomes Sent, a void is refused", () => {
  const routes = read("../routes/invoice-public.ts");
  assert.match(routes, /router\.post\("\/invoices\/:id\/send-email", sendCommunication,/);
  assert.match(routes, /getIdempotencyContext\(req, "invoices\.send_email"/);
  assert.match(routes, /withOpenKey\(`\$\{appUrl\(\)\}\/invoice\/\$\{created\.token\}`, delivery\.openKey\)/);
  assert.match(routes, /if \(invoice\.status === "draft" && results\.some\(\(r\) => r\.sent\)\)/);
  assert.match(routes, /const CLOSED = new Set\(\["voided", "credited"\]\);/);
});

test("migration invoice-public-v1 is registered after estimate-opens-v1, and additive", () => {
  const list = read("../migrations/application-migrations.ts");
  assert.ok(list.indexOf("  estimateOpensV1Migration,") < list.indexOf("  invoicePublicV1Migration,"));
  const migration = read("../migrations/invoice-public-v1.ts");
  assert.doesNotMatch(migration.slice(migration.indexOf("async function apply"), migration.indexOf("async function verify")), /\bUPDATE\b|\bDELETE\b|ALTER TABLE/);
});
