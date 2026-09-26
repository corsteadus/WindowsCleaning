import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { escapeHtml, officeAcceptedNotice, officeEmailAddress } from "./estimate-accepted-notice.ts";

const windows = { description: "Exterior windows", totalPrice: 300 };
const gutters = { description: "Gutter clearing", totalPrice: 150 };

describe("officeAcceptedNotice", () => {
  it("says who accepted what, and for how much, in the subject", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1042", customerName: "Jane Doe", acceptedTotal: 450,
      accepted: [windows, gutters], declined: [],
    });
    assert.equal(notice.subject, "Q-1042 accepted by Jane Doe — the whole estimate, $450.00");
  });

  it("makes a partial acceptance unmistakable in the subject", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1042", customerName: "Jane Doe", acceptedTotal: 300,
      accepted: [windows], declined: [gutters],
    });
    assert.equal(notice.subject, "Q-1042 accepted by Jane Doe — 1 of 2 services, $300.00");
  });

  it("lists what was turned down, so the wrong job is not booked", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1042", customerName: "Jane Doe", acceptedTotal: 300,
      accepted: [windows], declined: [gutters],
    });
    assert.match(notice.text, /Not accepted:/);
    assert.match(notice.text, /Gutter clearing/);
    assert.match(notice.html, /Not accepted/);
  });

  it("says nothing about a decline when the whole estimate was taken", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: "Jane", acceptedTotal: 450,
      accepted: [windows, gutters], declined: [],
    });
    assert.doesNotMatch(notice.text, /Not accepted/);
    assert.doesNotMatch(notice.html, /Not accepted/);
  });

  it("states plainly that nothing has been scheduled", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: "Jane", acceptedTotal: 300, accepted: [windows], declined: [],
    });
    assert.match(notice.text, /Nothing has been scheduled and no job has been created/);
    assert.match(notice.html, /Nothing has been scheduled and no job has been created/);
  });

  it("falls back to a neutral name when the estimate has none", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: null, acceptedTotal: 300, accepted: [windows], declined: [],
    });
    assert.match(notice.subject, /^Q-1 accepted by A customer/);
    assert.equal(
      officeAcceptedNotice({ quoteNumber: "Q-1", customerName: "   ", acceptedTotal: 1, accepted: [windows], declined: [] })
        .subject.includes("A customer"),
      true,
      "a name of only spaces is no name",
    );
  });

  it("formats money with a thousands separator and two decimals", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: "Jane", acceptedTotal: 12345.5,
      accepted: [{ description: "Whole building", totalPrice: 12345.5 }], declined: [],
    });
    assert.match(notice.subject, /\$12,345\.50/);
  });

  it("includes a link to the estimate when one is known, and none when it is not", () => {
    const withLink = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: "Jane", acceptedTotal: 300, accepted: [windows], declined: [],
      estimateUrl: "https://example.test/quotes/7",
    });
    assert.match(withLink.html, /href="https:\/\/example\.test\/quotes\/7"/);
    const without = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: "Jane", acceptedTotal: 300, accepted: [windows], declined: [],
    });
    assert.doesNotMatch(without.html, /<a /);
  });

  it("never lets a customer's name or a service reach the inbox as markup", () => {
    const notice = officeAcceptedNotice({
      quoteNumber: "Q-1", customerName: '<script>alert("x")</script>', acceptedTotal: 300,
      accepted: [{ description: "<img onerror=alert(1)>", totalPrice: 300 }], declined: [],
    });
    assert.doesNotMatch(notice.html, /<script>/);
    assert.doesNotMatch(notice.html, /<img /);
    assert.match(notice.html, /&lt;script&gt;/);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that could change the markup", () => {
    assert.equal(escapeHtml(`<a href="x" data='y'>&</a>`),
      "&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("officeEmailAddress", () => {
  it("prefers the office address", () => {
    assert.equal(
      officeEmailAddress({ OFFICE_EMAIL_ADDRESS: "info@corstead.us", EMAIL_FROM_ADDRESS: "no-reply@corstead.us" }),
      "info@corstead.us",
    );
  });

  it("falls back to the sending address", () => {
    assert.equal(officeEmailAddress({ EMAIL_FROM_ADDRESS: "no-reply@corstead.us" }), "no-reply@corstead.us");
  });

  it("returns nothing when neither is configured, rather than a broken address", () => {
    assert.equal(officeEmailAddress({}), null);
    assert.equal(officeEmailAddress({ OFFICE_EMAIL_ADDRESS: "   " }), null);
    assert.equal(officeEmailAddress({ OFFICE_EMAIL_ADDRESS: "not-an-address" }), null);
  });
});
