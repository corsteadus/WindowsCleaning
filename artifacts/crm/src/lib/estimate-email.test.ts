import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_ESTIMATE_TEXT, estimateTextToHtml, reachesEstimate } from "./estimate-email.ts";

test("blank lines make paragraphs, single lines break, and the link tags become links", () => {
  assert.equal(estimateTextToHtml("Hi {{first_name}},\n\nYour estimate: {{estimate_link}}\nThanks"),
    '<p>Hi {{first_name}},</p>\n<p>Your estimate: <a href="{{estimate_link}}">View your estimate (PDF)</a><br>Thanks</p>');
});

test("anything typed is text, never markup", () => {
  assert.equal(estimateTextToHtml("<script>x</script> & 'y'"), "<p>&lt;script&gt;x&lt;/script&gt; &amp; &#39;y&#39;</p>");
});

test("an email must give the customer the estimate: a link tag or the PDF attached", () => {
  assert.equal(reachesEstimate(DEFAULT_ESTIMATE_TEXT, false), true);
  assert.equal(reachesEstimate("Hello", false), false);
  assert.equal(reachesEstimate("Hello", true), true);
});
