import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseByteRange } from "./byte-range.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

// Phase 3: a video plays on a phone, and skips ahead, only if the server answers ranges.
describe("one byte range", () => {
  it("a start and an end", () => assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 }));
  it("from a point to the end — what a browser asks first", () => assert.deepEqual(parseByteRange("bytes=500-", 1000), { start: 500, end: 999 }));
  it("the last N bytes", () => assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 }));
  it("an end past the file is cut to the file", () => assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 }));
  it("a start past the file cannot be served", () => assert.equal(parseByteRange("bytes=1000-", 1000), "unsatisfiable"));
  it("no header, a malformed one, or several ranges get the whole file", () => {
    for (const header of [undefined, "", "items=0-1", "bytes=0-1,5-9", "bytes=-", "bytes=9-3"]) assert.equal(parseByteRange(header, 1000), null);
  });
});

describe("the wiring", () => {
  it("the file route answers a range with 206 and says it takes ranges", () => {
    const route = read("../routes/storage.ts");
    assert.match(route, /downloadObject\(objectFile, 3600, req\.headers\.range\)/);
    assert.match(read("./objectStorage.ts"), /status: 416/);
    assert.match(read("./objectStorage.ts"), /"Accept-Ranges": "bytes"/);
    assert.match(read("./objectStorage.ts"), /status: 206/);
  });
});
