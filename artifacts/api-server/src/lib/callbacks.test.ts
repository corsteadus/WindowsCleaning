import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { callbackNoteText, dueAtOf, outcomeNoteOf, outcomeOf, reasonOf } from "./callbacks.ts";
import { profileCallbacksV1Migration } from "../migrations/profile-callbacks-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const route = read("../routes/profile-callbacks.ts");

// Kyle, Video 4: spoke, left a message, or neither — and when to call next.
describe("a callback", () => {
  it("has one of three outcomes", () => {
    assert.deepEqual(["spoke", "left_message", "no_answer", "maybe", undefined].map(outcomeOf), ["spoke", "left_message", "no_answer", null, null]);
  });

  it("needs a real time to be due", () => {
    assert.deepEqual(dueAtOf("2026-10-28T15:00:00.000Z"), { dueAt: new Date("2026-10-28T15:00:00.000Z") });
    assert.ok("error" in dueAtOf(""));
    assert.ok("error" in dueAtOf("tomorrow-ish"));
  });

  it("a reason and a note are optional, trimmed and bounded", () => {
    assert.deepEqual(reasonOf("  Follow up on the estimate "), { reason: "Follow up on the estimate" });
    assert.deepEqual(reasonOf("   "), { reason: null });
    assert.ok("error" in reasonOf("x".repeat(501)));
    assert.deepEqual(outcomeNoteOf(undefined), { note: null });
  });

  it("a made call is written to the callback notes, with the next call in Chicago time", () => {
    assert.equal(callbackNoteText("left_message", "Voicemail full-ish", new Date("2026-10-28T15:00:00Z")),
      "Callback: Left a message. Voicemail full-ish Next callback Oct 28, 10:00 AM.");
    assert.equal(callbackNoteText("spoke", null, null), "Callback: Spoke with them.");
  });
});

describe("the wiring", () => {
  it("recording the outcome closes only an open callback, writes the note and books the next, in one transaction", () => {
    assert.match(route, /db\.transaction\(async \(tx\) =>/);
    assert.match(route, /eq\(profileCallbacksTable\.status, "open"\)/);
    assert.match(route, /kind: "callback", body: callbackNoteText\(outcome, note\.note, next\?\.dueAt \?\? null\)/);
  });

  it("a callback is read and changed only through its own profile", () => {
    assert.match(route, /eq\(profileCallbacksTable\.id, callbackId\), eq\(profileCallbacksTable\.customerId, id\)/);
  });

  it("only office staff can be given a callback, and technicians never see the list", () => {
    assert.match(route, /hasCapability\(user\.role, "customers\.manage"\)/);
    assert.match(route, /isAssignmentScopedOperationalRole\(req\.user\?\.role\)/);
    assert.match(read("./authorization.ts"), /\{ prefix: "\/callbacks", methods: \["GET"\], capability: "customers\.view" \}/);
    assert.match(read("./authorization.ts"), /\{ prefix: "\/callbacks", capability: "customers\.manage" \}/);
  });

  it("the migration only creates the new table, and is registered", async () => {
    const calls: string[] = [];
    let exists = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.tables")) return { rows: [{ count: exists }] };
      if (text.startsWith("CREATE TABLE profile_callbacks")) exists = 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await profileCallbacksV1Migration.preflight(context);
    await profileCallbacksV1Migration.apply(context, pre);
    await profileCallbacksV1Migration.verify(context);
    assert.ok(!calls.some((call) => /ALTER TABLE (?!profile_callbacks)|UPDATE |DELETE FROM/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(profileCallbacksV1Migration as never));
  });
});
