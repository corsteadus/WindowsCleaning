// Phase 8 (Kyle, Video 6): the business's name, details and logo on its estimates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const card = read("../components/CompanyBrandingCard.tsx");
const print = read("./QuotePrint.tsx");
const publicPage = read("./PublicEstimate.tsx");

test("Settings has Company & branding, for administrators", () => {
  assert.match(read("./Settings.tsx"), /<CompanyBrandingCard canManage=\{canManageQuoteSettings\} \/>/);
});

test("a logo is converted in the browser and kept at its own proportions", () => {
  assert.match(card, /const image = await logoToJpeg\(file\);/);
  assert.match(read("../lib/logo-image.ts"), /canvas\.toDataURL\("image\/jpeg", 0\.92\)/);
  assert.match(card, /className="max-h-full max-w-full object-contain"/);
});

test("the print is the business's, never a name written into the code", () => {
  assert.doesNotMatch(print, /<h1[^>]*>Superior Professional Window Cleaning<\/h1>/);
  assert.match(print, /\{brand\?\.businessName \?\? ""\}/);
  assert.match(print, />ESTIMATE</);
});

test("the print and the customer's page follow the business's choices, as the PDF does", () => {
  assert.match(print, /const showUnitPrices = brand\?\.showUnitPrices !== false;/);
  assert.match(publicPage, /branding\?\.showUnitPrices !== false \|\| line\.unitPrice == null/);
  assert.match(publicPage, /data-testid="public-branding"/);
});
