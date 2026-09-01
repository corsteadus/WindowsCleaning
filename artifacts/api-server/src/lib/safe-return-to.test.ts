import assert from "node:assert/strict";
import test from "node:test";
import { getSafeReturnTo } from "./safe-return-to.ts";

test("rejects network paths, backslashes, controls, and encoded escape forms", () => {
  for (const value of [
    "//evil.example/path",
    "/\\evil.example",
    "/%5cevil.example",
    "/%255cevil.example",
    "/%2f%2fevil.example",
    "/safe\u0000path",
    "/safe%0apath",
  ]) {
    assert.equal(getSafeReturnTo(value), "/", value);
  }
});

test("preserves a valid local path and query exactly", () => {
  assert.equal(getSafeReturnTo("/jobs/42?tab=notes&from=dashboard"), "/jobs/42?tab=notes&from=dashboard");
});