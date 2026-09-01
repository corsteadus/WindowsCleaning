/**
 * Tests for the local username/password login core and throttle.
 *
 * Run with:  node --test --experimental-strip-types src/lib/local-login.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateLocalUser,
  normalizeUsername,
  LoginThrottle,
  type LocalLoginDeps,
  type LocalLoginUser,
} from "./local-login.ts";

function makeUser(overrides: Partial<LocalLoginUser> = {}): LocalLoginUser {
  return {
    id: "user-1",
    email: "kyle@example.com",
    firstName: "Kyle",
    lastName: null,
    profileImageUrl: null,
    role: "super_admin",
    passwordHash: "stored-hash",
    isActive: true,
    ...overrides,
  };
}

function makeDeps(user: LocalLoginUser | null, passwordValid: boolean) {
  const calls = { find: [] as string[], verify: 0, burn: 0 };
  const deps: LocalLoginDeps = {
    async findUserByUsername(normalized) {
      calls.find.push(normalized);
      return user;
    },
    async verifyPassword() {
      calls.verify += 1;
      return passwordValid;
    },
    async burnPasswordCheck() {
      calls.burn += 1;
    },
  };
  return { deps, calls };
}

describe("normalizeUsername", () => {
  it("trims and lowercases", () => {
    assert.equal(normalizeUsername("  Superior "), "superior");
    assert.equal(normalizeUsername("ADMIN"), "admin");
    assert.equal(normalizeUsername("   "), "");
  });
});

describe("authenticateLocalUser", () => {
  it("succeeds with correct credentials and does not leak the hash", async () => {
    const { deps, calls } = makeDeps(makeUser(), true);
    const result = await authenticateLocalUser(deps, "  Superior ", "pw");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.id, "user-1");
      assert.equal(result.user.role, "super_admin");
      assert.equal(result.user.email, "kyle@example.com");
      assert.equal("passwordHash" in result.user, false);
    }
    assert.deepEqual(calls.find, ["superior"]); // lookup uses normalized name
    assert.equal(calls.verify, 1);
    assert.equal(calls.burn, 0);
  });

  it("fails for an unknown username and burns a timing check", async () => {
    const { deps, calls } = makeDeps(null, true);
    const result = await authenticateLocalUser(deps, "ghost", "pw");
    assert.equal(result.ok, false);
    assert.equal(calls.verify, 0);
    assert.equal(calls.burn, 1);
  });

  it("fails for a Replit-only account (no password set) with a burn", async () => {
    const { deps, calls } = makeDeps(makeUser({ passwordHash: null }), true);
    const result = await authenticateLocalUser(deps, "Superior", "pw");
    assert.equal(result.ok, false);
    assert.equal(calls.verify, 0);
    assert.equal(calls.burn, 1);
  });

  it("fails for an inactive local account even when the password is correct", async () => {
    const { deps, calls } = makeDeps(makeUser({ isActive: false }), true);
    const result = await authenticateLocalUser(deps, "Superior", "pw");
    assert.equal(result.ok, false);
    assert.equal(calls.verify, 0);
    assert.equal(calls.burn, 1);
  });

  it("fails on a wrong password", async () => {
    const { deps, calls } = makeDeps(makeUser(), false);
    const result = await authenticateLocalUser(deps, "Superior", "nope");
    assert.equal(result.ok, false);
    assert.equal(calls.verify, 1);
    assert.equal(calls.burn, 0);
  });

  it("fails on blank username or empty password without a lookup", async () => {
    const blankUser = makeDeps(makeUser(), true);
    assert.equal(
      (await authenticateLocalUser(blankUser.deps, "   ", "pw")).ok,
      false,
    );
    assert.equal(blankUser.calls.find.length, 0);

    const emptyPw = makeDeps(makeUser(), true);
    assert.equal(
      (await authenticateLocalUser(emptyPw.deps, "Superior", "")).ok,
      false,
    );
    assert.equal(emptyPw.calls.find.length, 0);
  });
});

describe("LoginThrottle", () => {
  it("blocks after maxFailures within the window", () => {
    let t = 0;
    const throttle = new LoginThrottle({ maxFailures: 3, windowMs: 1000, now: () => t });
    const key = "1.2.3.4|superior";
    assert.equal(throttle.isBlocked(key), false);
    throttle.recordFailure(key);
    throttle.recordFailure(key);
    assert.equal(throttle.isBlocked(key), false);
    throttle.recordFailure(key);
    assert.equal(throttle.isBlocked(key), true);
  });

  it("unblocks after the window expires and restarts the count", () => {
    let t = 0;
    const throttle = new LoginThrottle({ maxFailures: 2, windowMs: 1000, now: () => t });
    const key = "k";
    throttle.recordFailure(key);
    throttle.recordFailure(key);
    assert.equal(throttle.isBlocked(key), true);
    t = 1000; // window elapsed
    assert.equal(throttle.isBlocked(key), false);
    throttle.recordFailure(key); // fresh window, count = 1
    assert.equal(throttle.isBlocked(key), false);
  });

  it("reset clears the counter (successful login)", () => {
    const throttle = new LoginThrottle({ maxFailures: 1, windowMs: 60_000 });
    const key = "k";
    throttle.recordFailure(key);
    assert.equal(throttle.isBlocked(key), true);
    throttle.reset(key);
    assert.equal(throttle.isBlocked(key), false);
  });

  it("tracks keys independently", () => {
    const throttle = new LoginThrottle({ maxFailures: 1, windowMs: 60_000 });
    throttle.recordFailure("a");
    assert.equal(throttle.isBlocked("a"), true);
    assert.equal(throttle.isBlocked("b"), false);
  });
});
