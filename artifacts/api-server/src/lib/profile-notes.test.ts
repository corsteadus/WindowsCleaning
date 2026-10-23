import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MAX_NOTE_LENGTH, noteBodyOf, noteKindOf, serializeNotes } from "./profile-notes.ts";
import { profileNoteEntriesV1Migration } from "../migrations/profile-note-entries-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";
import { CUSTOMER_PURGE_ORDER } from "./customer-purge.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("dated, signed notes — Kyle's answer of 2026-10-21", () => {
  it("only specific and callback notes are dated entries", () => {
    assert.equal(noteKindOf("specific"), "specific");
    assert.equal(noteKindOf("callback"), "callback");
    assert.equal(noteKindOf("general"), null, "general notes stay a single box");
  });

  it("an empty note, or a pasted essay, is refused", () => {
    assert.deepEqual(noteBodyOf("  Call after 5  "), { body: "Call after 5" });
    assert.ok("error" in noteBodyOf("   "));
    assert.ok("error" in noteBodyOf("x".repeat(MAX_NOTE_LENGTH + 1)));
  });

  it("newest first; the text from before dated notes last, and unsigned", () => {
    const at = (iso: string) => new Date(iso);
    const out = serializeNotes([
      { id: 1, kind: "callback", body: "old box", createdAt: at("2026-10-20T10:00:00Z"), createdBy: "x", carriedOver: true },
      { id: 2, kind: "callback", body: "first", createdAt: at("2026-10-22T10:00:00Z"), createdBy: "Lute Atieh", carriedOver: false },
      { id: 3, kind: "callback", body: "second", createdAt: at("2026-10-23T10:00:00Z"), createdBy: "Kyle Stafford", carriedOver: false },
    ]);
    assert.deepEqual(out.map((note) => note.body), ["second", "first", "old box"]);
    assert.equal(out[2].createdBy, null);
    assert.equal(out[0].createdBy, "Kyle Stafford");
  });
});

describe("the migration — additive, carries the old text over, refuses to lose a note", () => {
  const run = async (state: { exists: number; legacy: number; written: number }) => {
    const calls: string[] = [];
    const context: any = {
      environment: "sandbox",
      migrationId: profileNoteEntriesV1Migration.id,
      client: {
        query: async (text: string) => {
          calls.push(text);
          if (text.includes("information_schema.tables")) return { rows: [{ count: state.exists }] };
          if (text.includes("CREATE TABLE profile_note_entries")) state.exists = 1;
          if (text.trim().startsWith("INSERT INTO profile_note_entries")) return { rows: [], rowCount: state.legacy };
          if (text.includes("WHERE NOT EXISTS")) return { rows: [{ count: 0 }] };
          if (text.includes("WHERE NOT carried_over")) return { rows: [{ count: state.written }] };
          if (text.includes("application_migration_backups") && text.includes("SELECT")) return { rows: [{ count: 1 }] };
          if (text.includes("FROM (")) return { rows: [{ count: state.legacy }] };
          if (text.startsWith("DROP TABLE")) state.exists = 0;
          return { rows: [], rowCount: 0 };
        },
      },
    };
    return { context, calls };
  };

  it("creates the table and copies each existing note in, touching nothing else", async () => {
    const state = { exists: 0, legacy: 3, written: 0 };
    const { context, calls } = await run(state);
    const pre = await profileNoteEntriesV1Migration.preflight(context);
    assert.equal(pre.legacyNotes, 3);
    await profileNoteEntriesV1Migration.backup(context, pre);
    const applied = await profileNoteEntriesV1Migration.apply(context, pre);
    assert.equal(applied.carriedOver, 3);
    await profileNoteEntriesV1Migration.postflight(context, pre);
    assert.ok(!calls.some((call) => /UPDATE customers|ALTER TABLE customers|DROP COLUMN/i.test(call)), "the old columns are never touched");
  });

  it("is Sandbox-only, and will not run over a table it did not make", async () => {
    const { context } = await run({ exists: 1, legacy: 0, written: 0 });
    await assert.rejects(profileNoteEntriesV1Migration.preflight(context), /outside its migration ledger/);
    await assert.rejects(profileNoteEntriesV1Migration.preflight({ ...context, environment: "production" }), /Sandbox-only/);
  });

  it("rollback refuses once anyone has written a note", async () => {
    const state = { exists: 1, legacy: 0, written: 2 };
    const { context } = await run(state);
    await assert.rejects(profileNoteEntriesV1Migration.rollback(context), /2 notes were written/);
    state.written = 0;
    await profileNoteEntriesV1Migration.rollback(context);
    assert.equal(state.exists, 0);
  });

  it("is registered, so the startup gate applies it", () => {
    assert.ok(REQUIRED_MIGRATIONS.includes(profileNoteEntriesV1Migration as never));
  });
});

describe("where the notes reach", () => {
  it("erasing a profile erases its notes", () => {
    assert.ok(CUSTOMER_PURGE_ORDER.some((step) => step.table === "profile_note_entries" && step.where === "customer_id = :id"));
  });

  it("a technician cannot read them", () => {
    const route = read("../routes/profile-notes.ts");
    assert.match(route, /router\.use\(\["\/customers\/:id\/notes", "\/prospects\/:id\/notes"\][\s\S]{0,200}isAssignmentScopedOperationalRole/);
  });

  it("a note is archived, never edited", () => {
    const route = read("../routes/profile-notes.ts");
    assert.doesNotMatch(route, /router\.(patch|put)\(/);
    assert.match(route, /set\(\{ archivedAt: new Date\(\), archivedBy: actorName\(req\) \}\)/);
  });
});
