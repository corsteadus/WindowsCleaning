import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  UNSUBSCRIBE_FALLBACK, UNSUBSCRIBE_PATH,
  hasUnsubscribeFooter, readUnsubscribeToken, suppressionReasonLabel,
  unsubscribeAddress, unsubscribeLink, unsubscribeSecret, unsubscribeToken,
  withUnsubscribeFooter,
} from "./unsubscribe.ts";

const SECRET = "a-secret-long-enough-to-be-one";
const OTHER = "a-different-secret-of-length";

describe("the unsubscribe token — Kyle #6", () => {
  it("round-trips the address it was made for", () => {
    const token = unsubscribeToken("Jane.Doe@Example.com", SECRET);
    assert.equal(readUnsubscribeToken(token, SECRET), "jane.doe@example.com");
  });

  it("normalises the same way the suppression list does", () => {
    // If these drifted, an unsubscribe would be recorded against an address
    // the dispatcher never checks, and the customer would keep receiving mail.
    assert.equal(unsubscribeAddress("  Jane.Doe@Example.COM "), "jane.doe@example.com");
    assert.equal(
      readUnsubscribeToken(unsubscribeToken(" JANE@x.com ", SECRET), SECRET),
      "jane@x.com",
    );
  });

  // The point of signing: otherwise anyone could unsubscribe anyone else's
  // customers by typing an address into a URL.
  it("refuses a token nobody signed", () => {
    const forged = Buffer.from("victim@example.com", "utf8").toString("base64url");
    assert.equal(readUnsubscribeToken(`${forged}.anything`, SECRET), null);
    assert.equal(readUnsubscribeToken(forged, SECRET), null);
  });

  it("refuses a token signed with a different secret", () => {
    assert.equal(readUnsubscribeToken(unsubscribeToken("a@b.com", OTHER), SECRET), null);
  });

  it("refuses a token whose address was swapped for another", () => {
    const real = unsubscribeToken("jane@example.com", SECRET);
    const signature = real.slice(real.indexOf(".") + 1);
    const swapped = `${Buffer.from("victim@example.com", "utf8").toString("base64url")}.${signature}`;
    assert.equal(readUnsubscribeToken(swapped, SECRET), null);
  });

  it("refuses rubbish without throwing", () => {
    for (const bad of [
      null, undefined, 42, {}, "", ".", "a.", ".b", "no-dot",
      "a.b.c", "!!!.???", "x".repeat(2000),
    ]) {
      assert.equal(readUnsubscribeToken(bad, SECRET), null, JSON.stringify(bad));
    }
  });

  it("refuses everything when there is no secret", () => {
    assert.equal(readUnsubscribeToken(unsubscribeToken("a@b.com", SECRET), null), null);
  });
});

describe("the secret itself", () => {
  it("is taken from the environment, and a short one does not count", () => {
    assert.equal(unsubscribeSecret({ UNSUBSCRIBE_SECRET: SECRET }), SECRET);
    // Worse than nothing: it looks configured and is trivially guessable.
    assert.equal(unsubscribeSecret({ UNSUBSCRIBE_SECRET: "short" }), null);
    assert.equal(unsubscribeSecret({ UNSUBSCRIBE_SECRET: "   " }), null);
    assert.equal(unsubscribeSecret({}), null);
  });
});

describe("the link", () => {
  it("is built from the app's own address", () => {
    const link = unsubscribeLink("https://app.example.com", "jane@example.com", SECRET);
    assert.ok(link?.startsWith(`https://app.example.com${UNSUBSCRIBE_PATH}/`), link ?? "null");
    assert.equal(readUnsubscribeToken(link.split("/").pop(), SECRET), "jane@example.com");
  });

  it("does not mind a trailing slash on the base", () => {
    const a = unsubscribeLink("https://x.test/", "j@x.com", SECRET);
    const b = unsubscribeLink("https://x.test", "j@x.com", SECRET);
    assert.equal(a, b);
    assert.doesNotMatch(a ?? "", /\/\/api/);
  });

  it("is null rather than broken when it cannot be built", () => {
    assert.equal(unsubscribeLink("https://x.test", "j@x.com", null), null, "no secret");
    assert.equal(unsubscribeLink("", "j@x.com", SECRET), null, "no base url");
    assert.equal(unsubscribeLink(undefined, "j@x.com", SECRET), null);
    assert.equal(unsubscribeLink("https://x.test", "   ", SECRET), null, "no address");
  });
});

describe("the footer", () => {
  it("adds the link when there is one", () => {
    const html = withUnsubscribeFooter("<p>Hello</p>", "https://x.test/api/public/unsubscribe/t");
    assert.match(html, /^<p>Hello<\/p>/);
    assert.match(html, /Unsubscribe/);
    assert.match(html, /https:\/\/x\.test\/api\/public\/unsubscribe\/t/);
  });

  // #6 rules out silence. A customer with no way out is the thing being fixed.
  it("still says how to get out when there is no link", () => {
    const html = withUnsubscribeFooter("<p>Hello</p>", null);
    assert.match(html, /reply to this message/i);
    assert.doesNotMatch(html, /<a /);
  });

  it("survives a body that is not a string", () => {
    assert.match(withUnsubscribeFooter(undefined as never, null), /reply to this message/i);
  });

  it("can tell whether one is already there, so a retry adds no second", () => {
    assert.equal(hasUnsubscribeFooter(withUnsubscribeFooter("<p>x</p>", "https://x.test" + UNSUBSCRIBE_PATH + "/t")), true);
    assert.equal(hasUnsubscribeFooter(withUnsubscribeFooter("<p>x</p>", null)), true);
    assert.equal(hasUnsubscribeFooter("<p>x</p>"), false);
    assert.equal(hasUnsubscribeFooter(undefined as never), false);
  });

  it("never loses the message it was given", () => {
    const body = "<p>Your estimate Q-1042 is ready.</p>";
    assert.ok(withUnsubscribeFooter(body, null).startsWith(body));
  });
});

describe("the link is actually wired in", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("every campaign email gets a footer, and it is logged as sent", () => {
    const processor = read("./campaign-processor.ts");
    assert.match(processor, /withUnsubscribeFooter\(/);
    // Added before the body is written to email_logs, so the record is what
    // the customer actually received.
    assert.match(processor, /const renderedBodyHtml = withUnsubscribeFooter\(/);
  });

  it("the public route is reachable without a session", () => {
    const authorization = read("./authorization.ts");
    assert.match(authorization, /req\.path\.startsWith\("\/public\/unsubscribe\/"\)/);
  });

  // Link checkers and mail gateways follow every URL in a message before a
  // human sees it. Acting on the GET would cut customers off who never
  // clicked.
  it("nothing is unsubscribed by merely opening the link", () => {
    const route = read("../routes/unsubscribe.ts");
    const get = route.slice(route.indexOf('router.get("/public/unsubscribe'), route.indexOf('router.post('));
    assert.doesNotMatch(get, /upsertSuppression/);
    assert.match(get, /<form method="post">/);
    assert.match(route, /router\.post\("\/public\/unsubscribe\/:token"/);
  });

  it("the page says what unsubscribing actually stops", () => {
    const route = read("../routes/unsubscribe.ts");
    // The scope is global, so it stops invoices too. Saying so is the point.
    assert.match(route, /scope: "global"/);
    assert.match(route, /estimates, appointment reminders and invoices/);
  });
});

describe("what the office reads on the profile", () => {
  it("uses Kyle's own words for the three reasons he named", () => {
    assert.equal(suppressionReasonLabel("marketing_unsubscribe"), "Customer unsubscribed");
    assert.equal(suppressionReasonLabel("provider_permanent_failure"), "Email bounced");
    assert.equal(suppressionReasonLabel("manual"), "Manually deactivated");
  });

  it("has something to say for the other stored reasons", () => {
    assert.equal(suppressionReasonLabel("complaint"), "Reported as spam");
    assert.equal(suppressionReasonLabel("invalid"), "Address is not valid");
  });

  it("says something plain rather than a code it does not know", () => {
    assert.equal(suppressionReasonLabel("something_new"), "Deactivated");
    assert.equal(suppressionReasonLabel(null), "Deactivated");
    assert.equal(suppressionReasonLabel(undefined), "Deactivated");
    assert.doesNotMatch(suppressionReasonLabel("something_new"), /_/);
  });
});
