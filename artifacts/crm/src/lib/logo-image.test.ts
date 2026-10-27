import assert from "node:assert/strict";
import { test } from "node:test";

import { logoSize } from "./logo-image.ts";

test("a logo keeps its proportions inside 600 × 200 and is never enlarged", () => {
  assert.deepEqual(logoSize(1200, 400), { width: 600, height: 200 });
  assert.deepEqual(logoSize(400, 800), { width: 100, height: 200 });
  assert.deepEqual(logoSize(150, 50), { width: 150, height: 50 });
});
