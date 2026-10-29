// A2 (Kyle, Video 7): which address opened an estimate, how often, and the office told.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isNewVisit, isValidOpenKey, newOpenKey, OPEN_NOTICE_INTERVAL_MS, OPEN_VISIT_GAP_MS, openKeyHash, openNoticeDue, withOpenKey,
} from "./estimate-opens.ts";
import { officeOpenedNotice } from "./estimate-accepted-notice.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every recipient's key is fresh, the right shape, and stored only as a hash", () => {
  const a = newOpenKey();
  const b = newOpenKey();
  assert.notEqual(a.key, b.key);
  assert.ok(isValidOpenKey(a.key));
  assert.equal(a.hash, openKeyHash(a.key));
  assert.notEqual(a.hash, a.key);
});

test("anything that is not a key is ignored, not an error", () => {
  for (const value of [undefined, null, "", "short", "x".repeat(17), "abc def ghi jklm", ["aaaaaaaaaaaaaaaa"]]) {
    assert.equal(isValidOpenKey(value), false, String(value));
  }
});

test("each address's copy of the link carries its key", () => {
  assert.equal(withOpenKey("https://x.test/estimate/T", "KEY"), "https://x.test/estimate/T?r=KEY");
  assert.equal(withOpenKey("https://x.test/a?b=1", "KEY"), "https://x.test/a?b=1&r=KEY");
  assert.equal(withOpenKey("https://x.test/estimate/T", null), "https://x.test/estimate/T", "no key, the plain link");
});

test("the office hears of the first open at once, then at most daily", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(openNoticeDue(null, now), true);
  assert.equal(openNoticeDue(new Date(now.getTime() - OPEN_NOTICE_INTERVAL_MS + 60_000), now), false);
  assert.equal(openNoticeDue(new Date(now.getTime() - OPEN_NOTICE_INTERVAL_MS), now), true);
  assert.equal(OPEN_NOTICE_INTERVAL_MS, 24 * 60 * 60 * 1000);
});

test("a reload within half an hour is the same visit", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(isNewVisit(null, now), true);
  assert.equal(isNewVisit(new Date(now.getTime() - 5 * 60_000), now), false);
  assert.equal(isNewVisit(new Date(now.getTime() - OPEN_VISIT_GAP_MS), now), true);
});

test("the opened notice says who, which address, and how often", () => {
  const first = officeOpenedNotice({ quoteNumber: "Q-7", customerName: "Ann Lee", recipient: "ann@example.com", openCount: 1, estimateUrl: "https://crm.test/quotes/7" });
  assert.equal(first.subject, "Q-7 opened by Ann Lee");
  assert.match(first.text, /Ann Lee opened estimate Q-7 for the first time, through the link sent to ann@example\.com\./);
  assert.match(first.html, /href="https:\/\/crm\.test\/quotes\/7"/);
  const again = officeOpenedNotice({ quoteNumber: "Q-7", customerName: null, recipient: null, openCount: 3 });
  assert.match(again.text, /A customer opened estimate Q-7 \(3 times so far\), through a copied link\./);
});

test("the notice never carries a customer's name as markup", () => {
  const notice = officeOpenedNotice({ quoteNumber: "Q-1", customerName: "<b>x</b>", recipient: "a@b.c", openCount: 1 });
  assert.doesNotMatch(notice.html, /<b>x<\/b>/);
  assert.match(notice.html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("opens by a signed-in team member count for nothing, and a decided estimate sends no notice", () => {
  const routes = read("../routes/estimates.ts");
  const body = routes.slice(routes.indexOf("async function recordOpen"), routes.indexOf("router.use(\"/public/estimates/:token\""));
  assert.match(body, /if \(req\.isAuthenticated\(\)\) return;/);
  assert.match(body, /if \(link\.decision \|\| !openNoticeDue\(lastNotified, now\)\) return null;/);
  assert.match(body, /\.for\("update"\)/, "the notice is claimed under a row lock, so two opens cannot both send it");
  assert.match(routes, /await recordOpen\(req, found, "page"\);/);
  assert.match(routes, /await recordOpen\(req, found, "pdf"\);/);
});

test("the estimate email gives each address its own copy of the link", () => {
  const email = read("../routes/estimate-email.ts");
  assert.match(email, /const rendered = await renderFor\(delivery\?\.openKey \?\? null\);/);
  assert.match(email, /withOpenKey\(`\$\{appUrl\(\)\}\/estimate\/\$\{created\.token\}`, openKey\)/);
});

test("the office never receives the key's hash", () => {
  assert.match(read("../routes/estimates.ts"), /deliveries: deliveries\.map\(\(\{ openKeyHash: _key, \.\.\.delivery \}\) => delivery\)/);
});

test("migration estimate-opens-v1 is registered after estimate-acceptance-v1, and additive", () => {
  const list = read("../migrations/application-migrations.ts");
  assert.ok(list.indexOf("  estimateAcceptanceV1Migration,") < list.indexOf("  estimateOpensV1Migration,"));
  const migration = read("../migrations/estimate-opens-v1.ts");
  assert.doesNotMatch(migration.slice(migration.indexOf("async function apply"), migration.indexOf("async function verify")), /\bUPDATE\b|\bDELETE\b/);
});
