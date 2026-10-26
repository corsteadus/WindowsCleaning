import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDiscounts, discountLabel, draftsToDiscounts } from "./discounts.ts";

const draft = (name: string, kind: "amount" | "percent", value: string) => ({ key: name, name, kind, value });

// The same cases as the server's lib/discounts.test.ts: both must agree to the cent.
test("the browser works discounts out exactly as the server does", () => {
  const result = applyDiscounts(500, [{ name: "Senior", kind: "percent", value: 10 }, { name: "Coupon", kind: "amount", value: 25 }]);
  assert.deepEqual([result.discountTotal, result.total], [75, 425]);
  assert.deepEqual(applyDiscounts(33.33, [{ name: "Third", kind: "percent", value: 33.33 }]).total, 22.22);
  assert.deepEqual(applyDiscounts(40, [{ name: "A", kind: "amount", value: 25 }, { name: "B", kind: "amount", value: 25 }]).discounts.map((d) => d.amount), [25, 15]);
});

test("a discount reads with its rate or amount", () => {
  assert.equal(discountLabel({ name: "Senior", kind: "percent", value: 10 }), "Senior (10%)");
  assert.equal(discountLabel({ name: "Coupon", kind: "amount", value: 25 }), "Coupon ($25.00)");
});

test("rows being typed: an untouched row is ignored; a half-filled one says what is missing", () => {
  assert.deepEqual(draftsToDiscounts([draft("", "percent", ""), draft("Senior", "percent", "10")]), { discounts: [{ name: "Senior", kind: "percent", value: 10 }] });
  assert.ok("error" in draftsToDiscounts([draft("", "amount", "5")]));
  assert.ok("error" in draftsToDiscounts([draft("Military", "percent", "150")]));
  assert.ok("error" in draftsToDiscounts([draft("Military", "amount", "")]));
});
