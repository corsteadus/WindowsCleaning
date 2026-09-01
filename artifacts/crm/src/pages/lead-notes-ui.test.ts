import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("lead notes are appended to activity and reflected in the detail cache", async () => {
  const [route, detail] = await Promise.all([
    readFile(new URL("../../../api-server/src/routes/leads.ts", import.meta.url), "utf8"),
    readFile(new URL("./LeadDetail.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /const initialNote = typeof body\.notes === "string" \? body\.notes\.trim\(\) : ""/);
  assert.match(route, /notes:\s+null,/);
  assert.match(route, /if \(initialNote\)[\s\S]*appendLeadNote\(tx, created\.id, initialNote/);
  assert.match(route, /router\.post\("\/leads\/:id\/notes"/);
  assert.match(detail, /queryClient\.setQueryData<LeadDetail>\(\["lead", id\]/);
  assert.match(detail, /\.filter\(l => l\.action === "note_added"\)/);
  assert.doesNotMatch(detail, /notes:\s+lead!\.notes/);
  assert.doesNotMatch(detail, /setForm\(f => \(\{ \.\.\.f, notes:/);
});