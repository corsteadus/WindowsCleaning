// Kyle, 2026-10-24: one Deactivate; separate lists; deactivated profiles on request.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
const detail = read("CustomerDetail.tsx");
const list = read("Customers.tsx");

test("the profile offers one Deactivate — for a prospect too — and no Archive", () => {
  assert.match(detail, /!isDeactivatedProfile\(customer\) && \(\s*<MenuItem icon=\{PowerOff\} label="Deactivate"/);
  assert.doesNotMatch(detail, /label="Archive"/);
  assert.match(detail, /isDeactivatedProfile\(customer\) && \(\s*<MenuItem icon=\{Power\} label="Reactivate"/);
});

test("the dialog says what deactivating keeps, and that Delete is separate", () => {
  assert.match(detail, /Deactivating keeps everything — information and history\./);
  assert.match(detail, /Nothing is deleted; that is Delete, separately\./);
});

test("each list is its own, with deactivated profiles only when asked", () => {
  assert.match(list, /const lifecycleStatus = isProspect \? "prospect" : "customer";/);
  assert.match(list, /if \(includeDeactivated\) params\.set\("includeDeactivated", "true"\);/);
  assert.match(list, /Include deactivated profiles/);
  for (const chip of ['{ label: "Inactive", value: "inactive" }', '{ label: "Archived", value: "archived" }', '{ label: "All Lifecycle", value: "" }']) {
    assert.ok(!list.includes(chip), `${chip} should be gone`);
  }
  assert.match(list, /\{ label: "Residential",\s+value: "residential" \}/, "the Residential / Commercial filter stays");
});
