/**
 * Tests for scrypt password hashing.
 *
 * Run with:  node --test --experimental-strip-types src/lib/password.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, burnPasswordCheck } from "./password.ts";

describe("hashPassword / verifyPassword", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("password-one");
    assert.equal(await verifyPassword("password-two", hash), false);
  });

  it("produces unique salts — same input, different hashes, both verify", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same-input", a), true);
    assert.equal(await verifyPassword("same-input", b), true);
  });

  it("emits the expected storage format", async () => {
    const hash = await hashPassword("x");
    const parts = hash.split(":");
    assert.equal(parts.length, 6);
    assert.equal(parts[0], "scrypt");
    assert.equal(parts[1], "16384");
    assert.equal(parts[2], "8");
    assert.equal(parts[3], "1");
    assert.match(parts[4]!, /^[0-9a-f]{32}$/);
    assert.match(parts[5]!, /^[0-9a-f]{128}$/);
  });

  it("rejects malformed stored values without throwing", async () => {
    const malformed = [
      "",
      "plaintext",
      "bcrypt:10:abc:def",
      "scrypt:16384:8:1:nothex:nothex",
      "scrypt:16384:8:1:aabb", // too few parts
      "scrypt:0:8:1:aabb:ccdd", // invalid N
      "scrypt:16383:8:1:aabb:ccdd", // N not a power of two
      "scrypt:2097152:8:1:aabb:ccdd", // N above bound
      "scrypt:16384:64:1:aabb:ccdd", // r above bound
      "scrypt:16384:8:8:aabb:ccdd", // p above bound
      "scrypt:16384:8:1:aab:ccdd", // odd-length salt hex
      // Valid hex but wrong decoded lengths — must be rejected BEFORE any
      // allocation or scrypt work (exact-format check).
      `scrypt:16384:8:1:${"aa".repeat(17)}:${"cc".repeat(64)}`, // salt 17 bytes
      `scrypt:16384:8:1:${"aa".repeat(16)}:${"cc".repeat(65)}`, // key 65 bytes
      `scrypt:16384:8:1:${"aa".repeat(4096)}:${"cc".repeat(64)}`, // oversized salt
      `scrypt:16384:8:1:${"aa".repeat(16)}:${"cc".repeat(8192)}`, // oversized key
    ];
    for (const bad of malformed) {
      assert.equal(
        await verifyPassword("anything", bad),
        false,
        `should reject: ${JSON.stringify(bad)}`,
      );
    }
  });

  it("burnPasswordCheck completes without throwing", async () => {
    await burnPasswordCheck("whatever");
    await burnPasswordCheck(""); // empty password path must also be safe
  });
});
