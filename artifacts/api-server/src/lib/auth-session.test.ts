import assert from "node:assert/strict";
import test from "node:test";
import type { SessionData } from "./auth.ts";

test("stored sessions contain identity rather than derived authorization context", () => {
  const session: SessionData = {
    user: {
      id: "user-1",
      email: "tech@example.test",
      firstName: "Field",
      lastName: "Tech",
      profileImageUrl: null,
      role: "team_tech",
    },
    access_token: "",
    auth_method: "local",
  };
  assert.deepEqual(Object.keys(session.user).sort(), [
    "email", "firstName", "id", "lastName", "profileImageUrl", "role",
  ]);
});