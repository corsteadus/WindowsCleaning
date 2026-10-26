import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultUploadLocation, fileKind, fileUrl, groupFilesByLocation, locationLabel } from "./profile-files.ts";

const home = { id: 1, label: "Home" };
const lake = { id: 2, label: "Lake house" };
const file = (id: number, propertyId: number | null, fileType = "image/jpeg") => ({ id, propertyId, fileType });

test("files sit under their own location, in the profile's order, then the profile's", () => {
  const groups = groupFilesByLocation([file(1, 2), file(2, null), file(3, 1), file(4, 2)], [home, lake]);
  assert.deepEqual(groups.map((group) => [group.location?.label ?? "profile", group.files.map((f) => f.id)]), [
    ["Home", [3]], ["Lake house", [1, 4]], ["profile", [2]],
  ]);
});

test("a location with no files is left out, and a removed location's files fall back to the profile", () => {
  const groups = groupFilesByLocation([file(1, 9)], [home, lake]);
  assert.deepEqual(groups.map((group) => group.key), ["profile"]);
});

test("photos, videos and PDFs are told apart", () => {
  assert.deepEqual(["image/png", "video/mp4", "video/quicktime", "application/pdf", "text/csv"].map(fileKind), ["image", "video", "video", "pdf", "other"]);
});

test("a new upload goes to the primary location; nowhere without locations", () => {
  assert.equal(defaultUploadLocation([home, lake]), 1);
  assert.equal(defaultUploadLocation([]), null);
});

test("a location by its name, else its street", () => {
  assert.equal(locationLabel({ name: " Lake house ", address: "1 Shore Rd" }), "Lake house");
  assert.equal(locationLabel({ name: "", address: "1 Shore Rd" }), "1 Shore Rd");
});

test("the original file is what is shown", () => {
  assert.equal(fileUrl("", "/objects/uploads/abc"), "/api/storage/objects/uploads/abc");
});
