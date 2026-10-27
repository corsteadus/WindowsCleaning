// Phase 7 (Kyle, Video 6; answer #5): the estimate email, and the estimate as a PDF.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dialog = read("../components/SendEstimateDialog.tsx");
const detail = read("./QuoteDetail.tsx");

test("the estimate page opens the real PDF, and emails the estimate from its delivery card", () => {
  assert.match(detail, /href=\{`\$\{BASE\}\/api\/quotes\/\$\{quoteId\}\/pdf`\}/);
  assert.match(detail, /<SendEstimateDialog quoteId=\{quote\.id\} open=\{sendOpen\}/);
  assert.doesNotMatch(detail, /Queue delivery/);
});

test("several of the profile's addresses; a new one is saved to the profile first", () => {
  assert.match(dialog, /estimateCall\(`\$\{draft\.data!\.profilePath\}\/channels`, \{ method: "POST"/);
  assert.match(dialog, /body: JSON\.stringify\(\{ to: \[\.\.\.to\], subject, bodyHtml, attachPdf \}\)/);
});

test("the link is the standard, the PDF attached is an option, and one of them is required", () => {
  assert.match(dialog, /const \[attachPdf, setAttachPdf\] = useState\(false\);/);
  assert.match(dialog, /const canSend = !blocked && to\.size > 0 && subject\.trim\(\) && text\.trim\(\) && reaches && !send\.isPending;/);
});

test("a preview before it goes, sandboxed; one click, one email", () => {
  assert.match(dialog, /<iframe title="Email preview" sandbox="" srcDoc=\{preview\.bodyHtml\}/);
  assert.match(dialog, /"Idempotency-Key": idempotencyKey\.current/);
});
