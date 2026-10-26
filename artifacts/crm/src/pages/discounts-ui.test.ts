// Phase 5 (Kyle, Video 5): named $ / % discounts that stack, and discounts that follow the customer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const detail = read("./QuoteDetail.tsx");
const quoteNew = read("./QuoteNew.tsx");
const publicPage = read("./PublicEstimate.tsx");
const print = read("./QuotePrint.tsx");
const profile = read("./CustomerDetail.tsx");

test("the estimate screen edits its discounts and saves them with the estimate", () => {
  assert.match(detail, /<DiscountEditor drafts=\{editDiscounts\}/);
  assert.match(detail, /discounts: discounts\.discounts,/);
  assert.match(detail, /if \("error" in discounts\) \{ setDiscountError\(discounts\.error\); return; \}/);
});

test("while editing, the total is worked out by the server's own rule", () => {
  assert.match(detail, /const editMoney = applyDiscounts\(editSubtotal,/);
  assert.match(detail, /const totalAmount = editing \? editMoney\.total : Number\(quote\.totalAmount \?\? quote\.subtotal\);/);
});

test("every total shows each discount by name", () => {
  assert.equal((detail.match(/<DiscountRows discounts=\{shownDiscounts\} \/>/g) ?? []).length, 2);
  assert.match(print, /quote\.discounts\.map\(\(discount, i\) =>/);
  assert.match(publicPage, /<DiscountRows discounts=\{shownMoney\.discounts\} \/>/);
});

test("the customer's page works the discounts out on the services they choose", () => {
  assert.match(publicPage, /applyDiscounts\(sumOf\(lines\.filter\(\(line\) => shownIds\.has\(line\.id\)\)\), discounts\)/);
});

test("a new estimate shows the profile's discounts it will start with", () => {
  assert.match(quoteNew, /const money = applyDiscounts\(subtotal, profileDiscounts\);/);
  assert.match(quoteNew, /\{formatCurrency\(money\.total\)\}/);
});

test("discounts that follow the profile sit in its Estimates section", () => {
  const section = profile.slice(profile.indexOf('id="quotes" title="Estimates"'));
  assert.ok(section.indexOf("<ProfileDiscounts") > 0 && section.indexOf("<ProfileDiscounts") < section.indexOf("<EstimatesView"));
});
