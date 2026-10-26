import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { attachmentLocationV1Migration } from "../migrations/attachment-location-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const route = read("./attachments.ts");

// Phase 3, Kyle's Videos 4 and 5: photos, documents and videos by job location.
describe("files by location", () => {
  it("a file is filed only under one of its own profile's locations", () => {
    assert.match(route, /eq\(propertiesTable\.id, propertyId\), eq\(propertiesTable\.customerId, entityId\)/);
    assert.match(route, /That location is not on this profile/);
  });

  it("uploading and moving both go through that check", () => {
    assert.match(route, /const location = await locationFor\(String\(entityType\), entityIdNum, propertyId\);/);
    assert.match(route, /const location = await locationFor\(row\.entityType, row\.entityId, req\.body\?\.propertyId\);/);
  });

  it("no location means the profile as a whole", () => {
    assert.match(route, /if \(raw === undefined \|\| raw === null \|\| raw === ""\) return \{ propertyId: null \};/);
  });

  it("moving a file is written to the profile's activity", () => {
    assert.match(route, /action: "file_moved"/);
  });

  it("the migration only adds a column and its index, and is registered", async () => {
    const calls: string[] = [];
    let exists = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.columns")) return { rows: [{ count: exists }] };
      if (text.startsWith("ALTER TABLE attachments ADD COLUMN")) exists = 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await attachmentLocationV1Migration.preflight(context);
    await attachmentLocationV1Migration.apply(context, pre);
    await attachmentLocationV1Migration.verify(context);
    assert.ok(calls.some((call) => /REFERENCES properties\(id\) ON DELETE SET NULL/.test(call)));
    assert.ok(!calls.some((call) => /UPDATE attachments|DELETE FROM attachments/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(attachmentLocationV1Migration as never));
  });
});
