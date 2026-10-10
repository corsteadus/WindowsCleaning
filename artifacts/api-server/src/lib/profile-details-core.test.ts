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
});

// Kyle #7. None is one of his eight choices, and it is not a deactivation:
// the address stays on the profile and can still be written to deliberately,
// it simply joins no routine category. This used to throw.
test("None is a choice — an empty purpose list is accepted and kept empty", () => {
  assert.deepEqual(channelPurposePatch({ purposes: [] }), []);
  assert.deepEqual(channelPurposePatch({ purpose: null }), []);
  assert.deepEqual(channelPurposePatch({ purposes: ["marketing"] }), [],
    "an unrecognised purpose leaves None, not an error");
});

test("saying nothing about purposes still leaves what is stored alone", () => {
  // Which is why None has to be an explicit empty array: omission already
  // means "do not touch".
  assert.equal(channelPurposePatch({ label: "Office" }), undefined);
  assert.equal(channelPurposePatch({}), undefined);
});