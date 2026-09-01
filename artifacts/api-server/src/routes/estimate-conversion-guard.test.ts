import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("estimate conversion route guards", () => {
  it("blocks both quote conversion and direct quote-linked job creation", async () => {
    const [quotes, jobs] = await Promise.all([
      readFile(new URL("./quotes.ts", import.meta.url), "utf8"),
      readFile(new URL("./jobs.ts", import.meta.url), "utf8"),
    ]);
    const quoteRoute = quotes.slice(quotes.indexOf('router.post("/quotes/:id/convert"'));
    assert.ok(quoteRoute.indexOf("estimate_conversion_deferred") < quoteRoute.indexOf("convertQuoteCore"));
    const jobRoute = jobs.slice(jobs.indexOf('router.post("/jobs"'));
    assert.ok(jobRoute.indexOf("estimate_conversion_deferred") < jobRoute.indexOf("const directValues"));
  });

  it("does not permit ordinary quote writes to create acceptance provenance", async () => {
    const [quotes, lifecycle] = await Promise.all([
      readFile(new URL("./quotes.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/estimate-lifecycle.ts", import.meta.url), "utf8"),
    ]);
    assert.match(quotes, /assertStaffWritableQuoteStatus\(body\.status\)/);
    assert.match(lifecycle, /assertStaffWritableQuoteStatus/);
    assert.match(lifecycle, /accepted/);
    assert.match(lifecycle, /approved/);
  });
});