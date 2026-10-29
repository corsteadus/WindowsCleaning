import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  acceptanceEmail, acceptanceMessage, acceptanceSettingsOf, acceptanceValues, customerNotesOf, fillAcceptanceTags, thankYouRecipients,
  DEFAULT_ACCEPTANCE_MESSAGE,
} from "./estimate-acceptance-content.ts";
import { officeAcceptedNotice, officeDeclinedNotice } from "./estimate-accepted-notice.ts";
import { estimateAcceptanceV1Migration } from "../migrations/estimate-acceptance-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const values = acceptanceValues({
  firstName: "Lute", customerName: "Lute Atieh", quoteNumber: "Q-9", businessName: "Superior <Co>",
  accepted: [{ description: "Windows" }, { description: "Gutters" }], acceptedTotal: 1234.5, customerNotes: "Gate is <open>",
});

describe("what the customer sees and is emailed after accepting (Videos 7, 9)", () => {
  it("fills the tags; an unknown tag is left as typed", () => {
    assert.equal(fillAcceptanceTags("Hi {{first_name}}, {{ estimate_number }} {{nope}}", values), "Hi Lute, Q-9 {{nope}}");
    assert.equal(values.accepted_services, "• Windows\n• Gutters");
    assert.equal(values.accepted_total, "$1,234.50");
  });

  it("a blank setting uses Corstead's short default; the business's own wording wins", () => {
    const none = { acceptanceMessage: null, acceptanceEmailEnabled: true, acceptanceEmailSubject: null, acceptanceEmailBody: null };
    assert.equal(acceptanceMessage(none, values), DEFAULT_ACCEPTANCE_MESSAGE.replace("{{first_name}}", "Lute"));
    assert.equal(acceptanceMessage({ ...none, acceptanceMessage: "Thanks {{customer_name}}!" }, values), "Thanks Lute Atieh!");
  });

  it("the email is escaped: a name or a note never becomes markup", () => {
    const none = { acceptanceMessage: null, acceptanceEmailEnabled: true, acceptanceEmailSubject: null, acceptanceEmailBody: "{{customer_notes}}\n\n{{business_name}}" };
    const email = acceptanceEmail(none, values);
    assert.equal(email.subject, "Thank you for accepting estimate Q-9");
    assert.match(email.html, /Gate is &lt;open&gt;/);
    assert.match(email.html, /Superior &lt;Co&gt;/);
    assert.ok(!email.html.includes("<open>"));
  });

  it("the customer's note is trimmed and bounded; empty is none", () => {
    assert.equal(customerNotesOf("  Please call first  "), "Please call first");
    assert.equal(customerNotesOf("   "), null);
    assert.equal(customerNotesOf(42), null);
    assert.equal(customerNotesOf("x".repeat(3000))!.length, 2000);
  });

  it("the settings must say whether the email is sent, and stay within their lengths", () => {
    assert.ok("error" in acceptanceSettingsOf({}));
    assert.ok("error" in acceptanceSettingsOf({ acceptanceEmailEnabled: true, acceptanceMessage: "x".repeat(4001) }));
    const ok = acceptanceSettingsOf({ acceptanceEmailEnabled: false, acceptanceMessage: "  ", acceptanceEmailSubject: " Hi " });
    assert.ok("settings" in ok && ok.settings.acceptanceMessage === null && ok.settings.acceptanceEmailSubject === "Hi" && !ok.settings.acceptanceEmailEnabled);
  });

  it("the thank-you goes where the estimate went, else to the profile's own address", () => {
    assert.deepEqual(thankYouRecipients([{ channel: "email", recipient: "A@x.com" }, { channel: "email", recipient: "a@x.com" }, { channel: "sms", recipient: "+1" }], "p@x.com"), ["a@x.com"]);
    assert.deepEqual(thankYouRecipients([], "P@x.com"), ["p@x.com"]);
    assert.deepEqual(thankYouRecipients([], null), []);
  });
});

describe("the office is told, with the customer's own words", () => {
  it("the accepted notice carries the Customer Notes (Video 7 must-have)", () => {
    const notice = officeAcceptedNotice({ quoteNumber: "Q-9", customerName: "Lute", acceptedTotal: 100, accepted: [{ description: "Windows", totalPrice: 100 }], declined: [], customerNotes: "Please <start> soon" });
    assert.match(notice.text, /Customer Notes:\nPlease <start> soon/);
    assert.match(notice.html, /Customer Notes<\/strong>.*Please &lt;start&gt; soon/s);
  });

  it("a decline is told too, with the reason and a follow-up request", () => {
    const notice = officeDeclinedNotice({ quoteNumber: "Q-9", customerName: "Lute", reason: "Too high", followUpRequested: true });
    assert.equal(notice.subject, "Q-9 declined by Lute");
    assert.match(notice.text, /Reason:\nToo high/);
    assert.match(notice.text, /asked to be contacted/);
    assert.match(officeDeclinedNotice({ quoteNumber: "Q-9" }).text, /\(none given\)/);
  });
});

describe("the wiring", () => {
  it("accepting keeps the note on the estimate and thanks the customer; declining tells the office", () => {
    const route = read("../routes/estimates.ts");
    assert.match(route, /customerNotes, customerNotesAt: customerNotes \? now : null/);
    assert.match(route, /void thankCustomerForAcceptance\(/);
    assert.match(route, /void notifyOffice\(found\.quote\.id, officeDeclinedNotice\(/);
    // Regression: the note typed while accepting used to be thrown away.
    assert.doesNotMatch(route, /declineReason: decision === "declined" \? String\(req\.body\.declineReason/);
  });

  it("the migration only adds columns, and is registered", async () => {
    const calls: string[] = [];
    let added = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.columns")) return { rows: [{ count: added }] };
      if (text.startsWith("ALTER TABLE quote_settings")) added = 6;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await estimateAcceptanceV1Migration.preflight(context);
    await estimateAcceptanceV1Migration.apply(context, pre);
    await estimateAcceptanceV1Migration.verify(context);
    assert.ok(!calls.some((call) => /UPDATE |DELETE FROM|DROP /.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(estimateAcceptanceV1Migration as never));
  });
});
