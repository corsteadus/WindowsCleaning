// A5 (Kyle, Video 8): one tag engine, templates for email / text / letter, and printed letters.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fillTags, htmlToText, PROFILE_TAG_KEYS, profileTagValues, textToHtml, unknownTagError, unknownTags } from "./merge-tags.ts";
import { smsSegments, templateOf } from "./message-templates.ts";
import { renderLetterPdf } from "./letter-document.ts";
import { renderEstimateEmail } from "./estimate-email.ts";
import { fillAcceptanceTags } from "./estimate-acceptance-content.ts";
import { renderTemplate } from "./email.ts";
import { interpolateTemplate } from "./communication-event-core.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const business = { businessName: "Superior", address: "1 Main St", city: "Lee's Summit", state: "MO", zip: "64063", phone: "8165550100", email: "office@example.com", website: null };

test("a tag is filled, escaped where asked, and an unknown one is kept or blanked", () => {
  assert.equal(fillTags("Hi {{ first_name }}", { first_name: "Ann" }), "Hi Ann");
  assert.equal(fillTags("{{name}}", { name: "<b>" }, { escape: true }), "&lt;b&gt;");
  assert.equal(fillTags("Hi {{nickname}}", {}), "Hi {{nickname}}");
  assert.equal(fillTags("Hi {{nickname}}", {}, { unknown: "blank" }), "Hi ");
  assert.equal(fillTags("{{toString}}", {}), "{{toString}}", "never a value from the prototype");
});

test("every older engine now goes through the one: same results as before", () => {
  assert.equal(renderTemplate("Hi {{first_name}} {{x}}", { first_name: "Ann" }), "Hi Ann ");
  assert.equal(interpolateTemplate("Paid {{amount}} .", { amount: null }), "Paid.");
  assert.equal(fillAcceptanceTags("Thanks {{ first_name }} {{oops}}", { first_name: "Ann" } as never), "Thanks Ann {{oops}}");
  const email = renderEstimateEmail("Estimate {{estimate_number}}", "<p>{{customer_name}}</p>", {
    estimateLink: "", estimatePageLink: "", firstName: "", customerName: "<Ann>", estimateNumber: "Q-1", estimateTotal: "", validUntil: "", businessName: "", senderName: "",
  });
  assert.equal(email.subject, "Estimate Q-1");
  assert.match(email.bodyHtml, /&lt;Ann&gt;/);
  for (const file of ["./estimate-email.ts", "./invoice-email.ts", "./estimate-acceptance-content.ts", "./email.ts", "./communication-event-core.ts"]) {
    assert.match(read(file), /from "\.\/merge-tags\.ts"/, file);
  }
});

test("a profile's values come from its record: address lines, greeting, company", () => {
  const values = profileTagValues({
    customer: { firstName: "Ann", lastName: "Lee", salutation: "Mrs.", companyName: "Lee Dental", clientType: "commercial", phone: "8165550142",
      billingAddress: "12 Cedar St", billingCity: "Kansas City", billingState: "MO", billingZip: "64111" },
    business, senderName: "Toheed", today: "2026-10-30",
  });
  assert.equal(values.billing_address, "12 Cedar St\nKansas City, MO 64111");
  assert.equal(values.salutation, "Mrs. Lee");
  assert.equal(values.customer_name, "Lee Dental");
  assert.equal(values.phone, "(816) 555-0142");
  assert.equal(values.today, "October 30, 2026");
  assert.equal(values.business_address, "1 Main St, Lee's Summit, MO 64063");
  assert.deepEqual(Object.keys(values).sort(), [...PROFILE_TAG_KEYS].sort(), "a value for every tag the picker offers");
});

test("an unknown tag is named, so the office can fix it before anything goes out", () => {
  assert.deepEqual(unknownTags("{{first_name}} {{frist_name}} {{frist_name}}", PROFILE_TAG_KEYS), ["{{frist_name}}"]);
  assert.match(unknownTagError(["Hi {{nick}}", "{{bad}}"])!, /\{\{nick\}\}, \{\{bad\}\} are not tags/);
  assert.equal(unknownTagError(["Hi {{first_name}}"]), null);
});

test("text and HTML both ways: typed text is escaped, an older email reads as text", () => {
  assert.equal(textToHtml("a <b>\nc\n\nd"), '<p style="margin:0 0 12px">a &lt;b&gt;<br>c</p><p style="margin:0 0 12px">d</p>');
  assert.equal(htmlToText("<p>Hi Ann,</p><p>See you<br>soon &amp; thanks</p>"), "Hi Ann,\n\nSee you\nsoon & thanks");
});

test("templates: per channel, checked as a whole", () => {
  assert.deepEqual(templateOf("email", { name: "x", bodyText: "y" }), { error: "An email template needs a subject" });
  const sms = templateOf("sms", { name: " Reminder ", subject: "dropped", bodyText: "Hi {{first_name}}" });
  assert.ok("template" in sms && sms.template.subject === "" && sms.template.name === "Reminder" && sms.template.bodyHtml === "");
  assert.match((templateOf("letter", { name: "x", bodyText: "{{estimate_link}}" }) as { error: string }).error, /estimate_link/, "a letter has no estimate link");
  assert.ok("template" in templateOf("email", { name: "x", subject: "s", bodyText: "{{estimate_link}}" }), "an email template may be used from an estimate");
  assert.match((templateOf("sms", { name: "x", bodyText: "a".repeat(1601) }) as { error: string }).error, /1,600/);
});

test("a text's length in texts", () => {
  assert.deepEqual(smsSegments("a".repeat(160)), { characters: 160, segments: 1, unicode: false });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("Hi — there").unicode, true);
});

test("the letter is a PDF, one page per customer, and refuses nothing to print", () => {
  const brand = { businessName: "Superior", contactLines: ["1 Main St"], logo: null };
  const letter = { date: "October 30, 2026", recipientLines: ["Ann Lee", "12 Cedar St", "Kansas City, MO 64111"], subject: "Spring", body: "Dear Ann,\n\nHello." };
  const pdf = renderLetterPdf([letter, letter], brand).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.throws(() => renderLetterPdf([], brand), /no letter/);
});

test("routes: the server fills the tags, refuses unknown ones, and the migration is additive", () => {
  const emails = read("../routes/emails.ts");
  assert.match(emails, /The tags are filled from the record, never from names the screen sent\./);
  assert.match(emails, /code: "unknown_tag"/);
  assert.doesNotMatch(emails, /buildTemplateVars\(\{ firstName: firstName \?\? ""/);
  assert.match(read("./authorization.ts"), /\{ prefix: "\/profile-messages", capability: "communication\.send" \}/);
  assert.match(read("./automation-engine.ts"), /eq\(emailTemplatesTable\.channel, "email"\)/);
  const list = read("../migrations/application-migrations.ts");
  assert.ok(list.indexOf("  jobArrivalWindowV1Migration,") < list.indexOf("  messageTemplatesV1Migration,"));
  const migration = read("../migrations/message-templates-v1.ts");
  assert.doesNotMatch(migration.slice(migration.indexOf("async function apply"), migration.indexOf("async function verify")), /\bUPDATE\b|\bDELETE\b|DROP/);
});
