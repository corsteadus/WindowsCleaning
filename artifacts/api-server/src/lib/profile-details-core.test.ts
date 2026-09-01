import assert from "node:assert/strict";
import test from "node:test";
import { catalogSelectionInput, channelPurposePatch } from "./profile-details-core.ts";

test("explicit catalog names and clears override stale IDs from loaded profile state", () => {
  assert.equal(
    catalogSelectionInput({ profileTypeId: 3, profileType: "VIP" }, "profileTypeId", "profileType"),
    "VIP",
  );
  assert.equal(
    catalogSelectionInput({ paymentTermsId: 4, paymentTerms: null }, "paymentTermsId", "paymentTerms"),
    null,
  );
  assert.equal(catalogSelectionInput({ profileGroupId: 9 }, "profileGroupId", "profileGroup"), 9);
});

test("partial channel patches preserve stored purposes when purpose fields are omitted", () => {
  assert.equal(channelPurposePatch({ label: "Office" }), undefined);
});

test("explicit channel-purpose patches normalize multiple supported values", () => {
  assert.deepEqual(channelPurposePatch({ purposes: ["billing", "estimates", "billing"] }), ["billing", "estimates"]);
  assert.deepEqual(channelPurposePatch({ purpose: "general" }), ["general"]);
  assert.throws(() => channelPurposePatch({ purposes: [] }), /valid channel purpose/);
});