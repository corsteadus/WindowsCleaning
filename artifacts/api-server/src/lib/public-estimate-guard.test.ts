import assert from "node:assert/strict";
import test from "node:test";
import {
  FixedWindowRequestLimiter,
  isValidPublicEstimateToken,
  publicEstimateLimitKey,
} from "./public-estimate-guard.ts";

test("public estimate tokens reject malformed and oversized probes before lookup", () => {
  assert.equal(isValidPublicEstimateToken("short"), false);
  assert.equal(isValidPublicEstimateToken("a".repeat(101)), false);
  assert.equal(isValidPublicEstimateToken(`${"a".repeat(40)}!`), false);
  assert.equal(isValidPublicEstimateToken("A_b-".repeat(10)), true);
});

test("public estimate limiter isolates token and client and resets its window", () => {
  const limiter = new FixedWindowRequestLimiter(2, 1000);
  const key = publicEstimateLimitKey("127.0.0.1", "a".repeat(40));
  assert.equal(limiter.allow(key, 0), true);
  assert.equal(limiter.allow(key, 1), true);
  assert.equal(limiter.allow(key, 2), false);
  assert.equal(limiter.allow(publicEstimateLimitKey("127.0.0.2", "a".repeat(40)), 2), true);
  assert.equal(limiter.allow(key, 1000), true);
});

test("public estimate limiter bounds distinct-token state and sweeps expired keys", () => {
  const limiter = new FixedWindowRequestLimiter(1, 1000, 2);
  assert.equal(limiter.allow("token-a", 0), true);
  assert.equal(limiter.allow("token-b", 0), true);
  assert.equal(limiter.allow("token-c", 0), false);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.allow("token-c", 1000), true);
  assert.equal(limiter.size, 1);
});