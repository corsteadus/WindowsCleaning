// Phase 6 (Kyle #2): sales tax — optional, never by default; state and county rates; Taxable per service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const detail = read("./QuoteDetail.tsx");
const picker = read("../components/SalesTaxPicker.tsx");
const invoices = read("./Invoices.tsx");

test("Settings has the business's state and county rates, for administrators", () => {
  assert.match(read("./Settings.tsx"), /<SalesTaxCard canManage=\{canManageQuoteSettings\} \/>/);
});

test("each service is Taxable or not, on the catalog", () => {
  const services = read("./Services.tsx");
  assert.match(services, /data-testid="input-service-taxable"/);
  assert.match(services, /body: JSON\.stringify\(\{ taxable: next \}\)/);
});

test("the estimate's tax: never by default, taxable per line, sent only when changed", () => {
  assert.match(detail, /data-testid="line-taxable"/);
  assert.match(detail, /\.\.\.\(sameTaxChoice\(editTax, savedTaxChoice\(quote\)\) \? \{\} : \{/);
  assert.match(detail, /taxable: Boolean\(service\.taxable\),/);
});

test("a Tax Exempt customer is never offered tax, with the reason shown", () => {
  assert.match(picker, /This customer is <strong>Tax Exempt<\/strong>, so this estimate charges no sales tax\./);
  assert.match(detail, /const editRate = taxExempt \? null : chosenRate\(taxRates\.data \?\? \[\], editTax\);/);
  assert.match(invoices, /if \(taxExempt && lines\.some\(\(line\) => cents\(line\.taxAmount\) > 0n\)\) return setError/);
});

test("the location's county suggests its rate", () => {
  assert.match(picker, /const suggestion = suggestedRates\(list, place\);/);
});

test("every total shows the tax: the estimate, the customer's page, the print", () => {
  assert.match(detail, /data-testid="tax-total-row"/);
  assert.match(read("./PublicEstimate.tsx"), /data-testid="public-tax"/);
  assert.match(read("./QuotePrint.tsx"), /Sales tax\{quote\.taxLabel \?/);
});

test("an invoice from a job carries the job's tax; a manual one can add it to taxable lines", () => {
  assert.match(invoices, /taxAmount: Number\(job\.taxTotal \?\? 0\) > 0 \? Number\(job\.taxTotal\)\.toFixed\(2\) : "",/);
  assert.match(invoices, /data-testid="invoice-apply-tax"/);
});
