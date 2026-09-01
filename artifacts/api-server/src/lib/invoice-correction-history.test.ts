import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeInvoiceCorrectionHistory } from "./invoice-correction-history.ts";

test("legacy invoice correction history serializes empty for detail and list enrichment", () => {
  const detail = serializeInvoiceCorrectionHistory({
    voidRecord: null,
    creditNotes: [],
    reissue: null,
    replacementOf: null,
  });
  const list = serializeInvoiceCorrectionHistory({
    voidRecord: null,
    creditNotes: [],
    reissue: null,
    replacementOf: null,
  });
  const expected = { void: null, creditNotes: [], reissue: null, replacementOf: null };
  assert.deepEqual(detail, expected);
  assert.deepEqual(list, expected);
});