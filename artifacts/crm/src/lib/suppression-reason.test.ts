import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SUPPRESSION_REASONS_KYLE_NAMED, suppressionReasonLabel,
} from "./suppression-reason.ts";

describe("why an address stopped receiving mail — Kyle #6", () => {
  it("says the three he named, in words", () => {
    assert.equal(suppressionReasonLabel("marketing_unsubscribe"), "Customer unsubscribed");
    assert.equal(suppressionReasonLabel("provider_permanent_failure"), "Email bounced");
    assert.equal(suppressionReasonLabel("manual"), "Manually deactivated");
  });

  it("has words for the other codes the database allows", () => {
    assert.equal(suppressionReasonLabel("complaint"), "Reported as spam");
    assert.equal(suppressionReasonLabel("invalid"), "Address is not valid");
  });

  it("never puts a raw code on screen", () => {
    for (const reason of [
      "marketing_unsubscribe", "provider_permanent_failure", "manual",
      "complaint", "invalid", "something_added_later", "", null, undefined,
    ]) {
      const label = suppressionReasonLabel(reason);
      assert.doesNotMatch(label, /_/, `${reason} leaked underscores`);
      assert.ok(label.length > 0);
    }
  });

  it("all three of Kyle's have a label", () => {
    for (const reason of SUPPRESSION_REASONS_KYLE_NAMED) {
      assert.notEqual(suppressionReasonLabel(reason), "Deactivated", reason);
    }
  });
});

describe("the profile shows it, and offers the way back", () => {
  const card = readFileSync(
    fileURLToPath(new URL("../components/CommunicationSafetyCard.tsx", import.meta.url)),
    "utf8",
  );

  it("prints the reason rather than the old jargon", () => {
    assert.match(card, /suppressionReasonLabel\(item\.suppression\.reason\)/);
    assert.doesNotMatch(card, /Durably suppressed for this channel/);
  });

  it("says the address is kept, which is the whole of #6's first line", () => {
    assert.match(card, /The address stays on the profile; only sending is stopped/);
  });

  it("offers reactivation, guarded by the capability the server checks", () => {
    assert.match(card, /const canManageSettings = capabilities\.includes\("communication\.settings"\)/);
    assert.match(card, /\{canManageSettings && \(/);
    assert.match(card, /communication-safety\/suppressions\/\$\{suppressionId\}/);
    assert.match(card, /method: "PATCH"/);
    // The server refuses anything but a deactivation of the suppression row,
    // so the history of it survives.
    assert.match(card, /body: JSON\.stringify\(\{ active: false \}\)/);
  });

  it("asks again after turning it back on, so the screen cannot lie", () => {
    assert.match(card, /invalidateQueries\(\{ queryKey: \["communication-safety", customerId\] \}\)/);
  });
});
