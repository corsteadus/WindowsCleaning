// Kyle (2026-10-26): Photos, Estimates, Callbacks and Email History as
// expandable sections under the profile, and Jump To kept to go straight there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const detail = read("./CustomerDetail.tsx");
const section = read("../components/ProfileSection.tsx");

test("the sections sit under the profile, in Kyle's order", () => {
  const block = detail.slice(detail.indexOf('data-testid="profile-sections"'));
  const order = ['id="files"', 'id="quotes"', 'id="callbacks"', 'id="activity"'].map((marker) => block.indexOf(marker));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), order.join(","));
  assert.match(detail, /const SECTION_VIEWS = \["files", "quotes", "callbacks", "activity"\] as const;/);
});

test("Jump To opens a section where it is, and only leaves the page for a view of its own", () => {
  assert.match(detail, /if \(isSection\(view\)\) \{\s*setActiveView\("profile"\);\s*setOpenSections/);
  assert.match(detail, /guard\(\(\) => setActiveView\(view\)\);/);
  assert.match(detail, /onClick=\{\(\) => jumpTo\(view\.id\)\}/);
});

test("a section is closed by default and mounts its content only when opened", () => {
  assert.match(section, /\{open && \(\s*<div id=\{`section-\$\{id\}-body`\}/);
  assert.match(section, /aria-expanded=\{open\}/);
});

test("each section still respects who may see it", () => {
  for (const id of ["files", "quotes", "activity"]) {
    assert.match(detail, new RegExp(`visibleViews\\.some\\(\\(view\\) => view\\.id === "${id}"\\) && \\(`));
  }
});
