import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  compareProfiles, displayName, filingName, neighborsOf, type NeighborRow,
} from "./profile-neighbors.ts";
import {
  mainEmail, mirrorPatch, PHONE_SLOTS, slotLabelOf, type MirrorChannel,
} from "./contact-mirror.ts";

const person = (id: number, lastName: string, firstName = "A", over: Partial<NeighborRow> = {}): NeighborRow => ({
  id, firstName, lastName, companyName: null, clientType: "residential", ...over,
});
const business = (id: number, companyName: string, over: Partial<NeighborRow> = {}): NeighborRow => ({
  id, firstName: "Contact", lastName: "Person", companyName, clientType: "commercial", ...over,
});

describe("Previous / Next order — Kyle, 2026-10-21", () => {
  it("files residential by last name and commercial by company name", () => {
    assert.equal(filingName(person(1, "Atieh", "Lute")), "Atieh");
    assert.equal(filingName(business(2, "Bright Glass Co")), "Bright Glass Co");
  });

  it("one list, interleaved by whichever name applies", () => {
    const rows = [person(1, "Carter"), business(2, "Bright Glass Co"), person(3, "Atieh")];
    const sorted = [...rows].sort(compareProfiles).map((row) => row.id);
    assert.deepEqual(sorted, [3, 2, 1]);
  });

  it("a commercial profile without a company name is filed by its contact, not at the front", () => {
    assert.equal(filingName(business(4, "   ", { lastName: "Zimmer" })), "Zimmer");
  });

  it("ignores case, and breaks ties by first name and then id so the order never wobbles", () => {
    const rows = [person(9, "smith", "Zoe"), person(8, "Smith", "Adam"), person(7, "SMITH", "Adam")];
    assert.deepEqual([...rows].sort(compareProfiles).map((row) => row.id), [7, 8, 9]);
  });

  it("finds the profiles either side", () => {
    const rows = [person(1, "Atieh", "Lute"), person(2, "Brown"), person(3, "Carter")];
    const { previous, next } = neighborsOf(rows, rows[1]);
    assert.deepEqual(previous, { id: 1, name: "Atieh, Lute" });
    assert.equal(next?.id, 3);
  });

  it("stops at either end rather than wrapping round", () => {
    const rows = [person(1, "Atieh"), person(2, "Brown")];
    assert.equal(neighborsOf(rows, rows[0]).previous, null);
    assert.equal(neighborsOf(rows, rows[1]).next, null);
  });

  it("a profile opened from search that is not in the active list still has live arrows", () => {
    const rows = [person(1, "Atieh"), person(3, "Carter")];
    const archived = person(2, "Brown");
    const { previous, next } = neighborsOf(rows, archived);
    assert.equal(previous?.id, 1);
    assert.equal(next?.id, 3);
  });

  it("names a commercial neighbour by its company", () => {
    assert.equal(displayName(business(5, "Bright Glass Co")), "Bright Glass Co");
  });
});

describe("the flat columns follow the channels — the contact source decision", () => {
  const phone = (id: number, label: string, value: string, over: Partial<MirrorChannel> = {}): MirrorChannel =>
    ({ id, channelType: "phone", label, value, ...over });
  const email = (id: number, value: string, over: Partial<MirrorChannel> = {}): MirrorChannel =>
    ({ id, channelType: "email", label: null, value, ...over });

  it("has Kyle's six phones, in his order", () => {
    assert.deepEqual(PHONE_SLOTS.map((slot) => slot.label), ["Home", "Work", "Cell", "Cell 2", "Alt", "Fax"]);
  });

  it("recognises a slot whatever its case or spacing, and nothing else", () => {
    assert.equal(slotLabelOf(" home "), "Home");
    assert.equal(slotLabelOf("CELL 2"), "Cell 2");
    assert.equal(slotLabelOf("Office"), null);
    assert.equal(slotLabelOf(null), null);
  });

  it("copies each slot's number onto its flat column", () => {
    const patch = mirrorPatch({
      channels: [phone(1, "Cell", "816-123-4567"), phone(2, "Home", "816-555-0000")],
      customer: { cellPhone: null, homePhone: null },
    });
    assert.deepEqual(patch, { cellPhone: "816-123-4567", homePhone: "816-555-0000" });
  });

  it("writes nothing when the flat column already holds the same number, however it is formatted", () => {
    const patch = mirrorPatch({
      channels: [phone(1, "Cell", "(816) 123-4567")],
      customer: { cellPhone: "816-123-4567" },
    });
    assert.deepEqual(patch, {});
  });

  it("a second cell and a label that is not a slot have no column, and touch nothing", () => {
    const patch = mirrorPatch({
      channels: [phone(1, "Cell 2", "816-111-1111"), phone(2, "Office", "816-222-2222")],
      customer: { cellPhone: "816-999-9999" },
    });
    assert.deepEqual(patch, {});
  });

  // A profile from before the redesign has flat numbers and no channels. An
  // unrelated edit must not wipe them.
  it("leaves a slot alone when it has no channel", () => {
    const patch = mirrorPatch({
      channels: [phone(1, "Cell", "816-123-4567")],
      customer: { homePhone: "816-555-0000", cellPhone: "816-123-4567" },
    });
    assert.deepEqual(patch, {});
  });

  it("clears the column when its only channel is deleted, so a removed number does not come back", () => {
    const removed = phone(1, "Home", "816-555-0000");
    const patch = mirrorPatch({ channels: [], customer: { homePhone: "(816) 555-0000" }, removed });
    assert.deepEqual(patch, { homePhone: null });
  });

  it("but not when the column holds something else by then", () => {
    const removed = phone(1, "Home", "816-555-0000");
    const patch = mirrorPatch({ channels: [], customer: { homePhone: "816-777-7777" }, removed });
    assert.deepEqual(patch, {});
  });

  it("an archived channel counts as gone", () => {
    const patch = mirrorPatch({
      channels: [phone(1, "Cell", "816-123-4567", { archivedAt: new Date() })],
      customer: { cellPhone: null },
    });
    assert.deepEqual(patch, {});
  });

  it("the account's email is the primary one, else the oldest", () => {
    assert.equal(mainEmail([email(5, "b@x.com"), email(3, "a@x.com")])?.value, "a@x.com");
    assert.equal(mainEmail([email(3, "a@x.com"), email(5, "b@x.com", { isPrimary: true })])?.value, "b@x.com");
    assert.equal(mainEmail([]), null);
  });

  it("copies the main email, and a second address for a spouse changes nothing", () => {
    const patch = mirrorPatch({
      channels: [email(1, "lute@corstead.us"), email(2, "lauren@corstead.us")],
      customer: { email: null },
    });
    assert.deepEqual(patch, { email: "lute@corstead.us" });
  });

  it("removing the main email moves the account to the next one", () => {
    const patch = mirrorPatch({
      channels: [email(2, "lauren@corstead.us")],
      customer: { email: "lute@corstead.us" },
      removed: email(1, "lute@corstead.us"),
    });
    assert.deepEqual(patch, { email: "lauren@corstead.us" });
  });

  it("removing the only email clears it", () => {
    const patch = mirrorPatch({
      channels: [],
      customer: { email: "LUTE@corstead.us" },
      removed: email(1, "lute@corstead.us"),
    });
    assert.deepEqual(patch, { email: null });
  });

  // Found in the walkthrough: an older profile's own address lived only in the
  // column, and adding the spouse's address replaced it.
  it("an older profile's own email is not replaced by a second address", () => {
    const patch = mirrorPatch({
      channels: [email(9, "lauren@corstead.us")],
      customer: { email: "lute@corstead.us" },
    });
    assert.deepEqual(patch, {});
  });

  it("editing the address the column holds still updates the column", () => {
    const patch = mirrorPatch({
      channels: [email(1, "lute.new@corstead.us")],
      customer: { email: "lute@corstead.us" },
      removed: email(1, "lute@corstead.us"),
    });
    assert.deepEqual(patch, { email: "lute.new@corstead.us" });
  });
});

describe("the routes use both", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const details = read("../routes/profile-details.ts");
  const customers = read("../routes/customers.ts");

  it("every channel change re-mirrors the flat columns, inside the same transaction", () => {
    assert.match(details, /await mirrorChannelsOntoCustomer\(tx, customerId\)/);
    assert.match(details, /await mirrorChannelsOntoCustomer\(tx, current\.customerId, current\)/);
  });

  it("Previous/Next is served for both prospects and customers", () => {
    assert.match(customers, /router\.get\(\["\/customers\/:id\/neighbors", "\/prospects\/:id\/neighbors"\]/);
  });

  it("a technician cannot walk the whole database with the arrows", () => {
    const route = customers.slice(customers.indexOf('"/customers/:id/neighbors"'));
    assert.match(route.slice(0, 1200), /isAssignmentScopedOperationalRole\(req\.user\?\.role\)/);
  });
});
