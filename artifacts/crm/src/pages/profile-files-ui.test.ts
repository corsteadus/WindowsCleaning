// Phase 3 (Kyle, Videos 4 and 5): photos, videos and files by location, never squished.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const files = read("../components/FilesTab.tsx");
const detail = read("./CustomerDetail.tsx");

test("a photo is shown whole at its own proportions — in the tile and in the viewer", () => {
  assert.match(files, /<img src=\{src\} alt=\{att\.fileName\} loading="lazy" onError=\{\(\) => setBroken\(true\)\} className="h-full w-full object-contain" \/>/);
  assert.match(files, /data-testid="file-viewer-image"[^>]*\n\s*className="max-h-\[60vh\] max-w-full object-contain"/);
  assert.doesNotMatch(files, /object-cover/);
});

test("videos can be uploaded and play in place, on a phone too", () => {
  assert.match(files, /accept="image\/\*,video\/\*,/);
  assert.match(files, /<video data-testid="file-viewer-video" src=\{fileUrl\(BASE, viewing\.objectPath\)\} controls playsInline/);
});

test("an upload is filed under the chosen location, and a file can be moved", () => {
  assert.match(files, /propertyId: uploadLocation,/);
  assert.match(files, /method: "PATCH",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON\.stringify\(\{ propertyId \}\)/);
});

test("the profile hands its live locations over, primary first", () => {
  assert.match(detail, /<FilesTab entityType="customer" entityId=\{customer\.id\}\s*locations=\{\[\.\.\.activeProperties\]\.sort\(\(a, b\) => Number\(b\.isPrimary\) - Number\(a\.isPrimary\)\)/);
});

test("delete and download live in the viewer, so they work on a touch screen", () => {
  assert.doesNotMatch(files, /opacity-0 group-hover:opacity-100/);
  assert.match(files, /data-testid="file-delete"/);
});
