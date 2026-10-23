import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PHONE_SLOTS, accountPatch, addressPlan, contactPlan, emailRowsFrom, otherPhones,
  phoneRowsFrom, unsavedSummary, updateSteps,
  type AddressRow, type ChannelLike, type EmailRow, type PhoneRow,
} from "./profile-sheet.ts";

const phone = (id: number, label: string, value: string, contactId: number | null = null): ChannelLike =>
  ({ id, type: "phone", label, value, contactId });
const email = (id: number, value: string, contactId: number | null = null): ChannelLike =>
  ({ id, type: "email", label: "Email", value, contactId });
const edit = (rows: PhoneRow[], slot: string, patch: Partial<PhoneRow>) =>
  rows.map((row) => (row.slot === slot ? { ...row, ...patch } : row));

describe("the six phones — Kyle's answer #5", () => {
  it("are Home, Work, Cell, Cell 2, Alt and Fax, in that order", () => {
    assert.deepEqual(PHONE_SLOTS.map((slot) => slot.label), ["Home", "Work", "Cell", "Cell 2", "Alt", "Fax"]);
    assert.deepEqual(phoneRowsFrom([], {}).map((row) => row.slot), ["Home", "Work", "Cell", "Cell 2", "Alt", "Fax"]);
  });

  it("fill from channels, with whose number it is", () => {
    const rows = phoneRowsFrom([phone(4, "cell", "816-123-4567", 9)], {});
    const cell = rows.find((row) => row.slot === "Cell")!;
    assert.deepEqual([cell.channelId, cell.value, cell.contact, cell.fromFlat], [4, "816-123-4567", 9, false]);
  });

  // A profile from before the redesign: flat numbers, no channels.
  it("fall back to the old columns, so nothing on an older profile disappears", () => {
    const rows = phoneRowsFrom([], { homePhone: "816-555-0000", fax: "816-555-1111" });
    assert.equal(rows.find((row) => row.slot === "Home")?.value, "816-555-0000");
    assert.equal(rows.find((row) => row.slot === "Home")?.fromFlat, true);
    assert.equal(rows.find((row) => row.slot === "Fax")?.value, "816-555-1111");
    assert.equal(rows.find((row) => row.slot === "Cell 2")?.value, "");
  });

  it("a channel beats the old column for the same slot", () => {
    const rows = phoneRowsFrom([phone(1, "Home", "816-000-0001")], { homePhone: "816-999-9999" });
    assert.equal(rows.find((row) => row.slot === "Home")?.value, "816-000-0001");
  });

  it("keeps every phone that is not one of the six, so none is lost", () => {
    const extra = otherPhones([phone(1, "Home", "1"), phone(2, "Office", "2"), phone(3, "Home", "3")]);
    assert.deepEqual(extra.map((item) => item.id), [2, 3]);
  });
});

describe("what Update does to phones", () => {
  const start = phoneRowsFrom([phone(1, "Cell", "816-123-4567")], { homePhone: "816-555-0000" });

  it("nothing touched, nothing sent", () => {
    assert.deepEqual(contactPlan({ phonesBefore: start, phonesAfter: start, emailsBefore: [], emailsAfter: [] }).ops, []);
  });

  it("reformatting a number is not a change", () => {
    const after = edit(start, "Cell", { value: "(816) 123-4567" });
    assert.deepEqual(contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops, []);
  });

  it("editing a channel's number updates it", () => {
    const after = edit(start, "Cell", { value: "816-000-1111" });
    const { ops } = contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] });
    assert.deepEqual(ops, [{ kind: "update", id: 1, value: "816-000-1111", contact: null, newPerson: undefined, rowKey: "phone:Cell" }]);
  });

  it("naming whose number it is, without changing it, is still saved", () => {
    const after = edit(start, "Cell", { contact: 7 });
    assert.equal(contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops[0].kind, "update");
  });

  it("clearing a channel's number removes the channel", () => {
    const after = edit(start, "Cell", { value: "" });
    assert.deepEqual(contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops,
      [{ kind: "remove", id: 1, rowKey: "phone:Cell" }]);
  });

  it("filling an empty slot creates a channel labelled with the slot", () => {
    const after = edit(start, "Cell 2", { value: "816-222-3333", contact: 5 });
    const [op] = contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops;
    assert.deepEqual(op, { kind: "create", type: "phone", label: "Cell 2", value: "816-222-3333", contact: 5, newPerson: undefined, rowKey: "phone:Cell 2" });
  });

  it("editing an old-column number turns it into a channel", () => {
    const after = edit(start, "Home", { value: "816-555-0001" });
    const [op] = contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops;
    assert.equal(op.kind, "create");
  });

  it("clearing an old-column number clears the column itself, since there is no channel to remove", () => {
    const after = edit(start, "Home", { value: "" });
    const plan = contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] });
    assert.deepEqual(plan.ops, []);
    assert.deepEqual(plan.flatClear, { homePhone: null });
  });

  it("a new person can own a number", () => {
    const after = edit(start, "Cell 2", { value: "816-1", contact: "new", newPerson: { firstName: "Lauren", lastName: "Atieh" } });
    const [op] = contactPlan({ phonesBefore: start, phonesAfter: after, emailsBefore: [], emailsAfter: [] }).ops;
    assert.equal(op.kind === "create" && op.newPerson?.firstName, "Lauren");
  });
});

describe("what Update does to emails", () => {
  const before = emailRowsFrom([email(1, "lute@corstead.us", 3)], {});

  it("lists every email with its person", () => {
    assert.deepEqual(before.map((row) => [row.channelId, row.value, row.contact]), [[1, "lute@corstead.us", 3]]);
  });

  it("shows the old single column too, first, unless a channel already holds it", () => {
    assert.deepEqual(emailRowsFrom([], { email: "old@x.com" }).map((row) => row.fromFlat), [true]);
    assert.deepEqual(emailRowsFrom([], {}), []);
    // Found in the walkthrough: adding a spouse's address hid the account's own.
    assert.deepEqual(emailRowsFrom([email(9, "lauren@x.com")], { email: "lute@x.com" }).map((row) => row.value),
      ["lute@x.com", "lauren@x.com"]);
    assert.deepEqual(emailRowsFrom([email(1, "LUTE@x.com")], { email: "lute@x.com" }).map((row) => row.channelId), [1]);
  });

  // Video 3: "Send that estimate to my wife."
  it("a second address for a spouse is created with her name", () => {
    const after: EmailRow[] = [...before, { key: "n1", channelId: null, value: "lauren@corstead.us", contact: "new", newPerson: { firstName: "Lauren", lastName: "Atieh" }, fromFlat: false }];
    const { ops } = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: after });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].kind === "create" && ops[0].value, "lauren@corstead.us");
  });

  it("a blank new row is ignored, not saved as an empty address", () => {
    const after: EmailRow[] = [...before, { key: "n1", channelId: null, value: "  ", contact: null, fromFlat: false }];
    assert.deepEqual(contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: after }).ops, []);
  });

  it("changing case is not a change", () => {
    const after = before.map((row) => ({ ...row, value: "LUTE@corstead.us" }));
    assert.deepEqual(contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: after }).ops, []);
  });

  // Kyle #7: routing per address is a feature, and the new page keeps it.
  it("changing an address's routing is saved, and a new address defaults to General", () => {
    const rerouted = before.map((row) => ({ ...row, purposes: ["billing"] }));
    const [op] = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: rerouted }).ops;
    assert.equal(op.kind === "update" && op.purposes?.join(), "billing");
    const added: EmailRow[] = [...before, { key: "n1", channelId: null, value: "a@b.co", contact: null, fromFlat: false }];
    const [create] = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: added }).ops;
    assert.equal(create.kind === "create" && create.purposes?.join(), "general");
  });

  it("None is a routing too, and is not mistaken for the default", () => {
    const none = before.map((row) => ({ ...row, purposes: [] }));
    assert.equal(contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: none }).ops.length, 1);
  });

  // The old Profile Details tab could pause sending to an address; so can this.
  it("pausing an address is saved on its own, and un-pausing too", () => {
    const paused = before.map((row) => ({ ...row, sendingPaused: true }));
    const [op] = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: paused }).ops;
    assert.equal(op.kind === "update" && op.sendingPaused, true);
    const [undo] = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: paused, emailsAfter: before }).ops;
    assert.equal(undo.kind === "update" && undo.sendingPaused, false);
    const rerouted = before.map((row) => ({ ...row, purposes: ["billing"] }));
    const [other] = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: rerouted }).ops;
    assert.ok(other.kind === "update" && !("sendingPaused" in other), "an untouched pause is not sent");
  });

  it("removing a row removes its channel", () => {
    assert.deepEqual(contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: before, emailsAfter: [] }).ops,
      [{ kind: "remove", id: 1, rowKey: "email:c1" }]);
  });

  it("an old-column email that is edited becomes a channel, and is not also cleared", () => {
    const flat = emailRowsFrom([], { email: "old@x.com" });
    const after = flat.map((row) => ({ ...row, value: "new@x.com" }));
    const plan = contactPlan({ phonesBefore: [], phonesAfter: [], emailsBefore: flat, emailsAfter: after });
    assert.equal(plan.ops[0].kind, "create");
    assert.deepEqual(plan.flatClear, {});
  });
});

describe("addresses — Kyle's answer #6 and Video 3", () => {
  const main: AddressRow = { key: "p1", propertyId: 1, name: "", address: "4818 Lakewood Dr", city: "St. Joseph", state: "MO", zip: "64506", isPrimary: true };

  it("correcting the street number sends only that field — Video 3, 4818 to 4820", () => {
    const { ops, problems } = addressPlan([main], [{ ...main, address: "4820 Lakewood Dr" }]);
    assert.deepEqual(ops, [{ kind: "update", key: "p1", propertyId: 1, data: { address: "4820 Lakewood Dr" } }]);
    assert.deepEqual(problems, []);
  });

  it("a new named location is created", () => {
    const mom: AddressRow = { key: "n1", propertyId: null, name: "Mom's house", address: "5908 N Bell Hwy", city: "St. Joseph", state: "MO", zip: "64505", isPrimary: false };
    const { ops } = addressPlan([main], [main, mom]);
    assert.equal(ops[0].kind, "create");
    assert.equal(ops[0].kind === "create" && ops[0].data.name, "Mom's house");
  });

  it("an empty new row is ignored", () => {
    const blank: AddressRow = { key: "n1", propertyId: null, name: "", address: "", city: "", state: "", zip: "", isPrimary: false };
    assert.deepEqual(addressPlan([main], [main, blank]), { ops: [], problems: [] });
  });

  it("says what is missing rather than failing on the server", () => {
    const half: AddressRow = { key: "n1", propertyId: null, name: "Rental", address: "1 Main St", city: "", state: "MO", zip: "", isPrimary: false };
    assert.deepEqual(addressPlan([main], [main, half]).problems, ["Rental needs city, zip"]);
  });
});

describe("the account's own fields", () => {
  it("sends only what changed, and blanks as null", () => {
    assert.deepEqual(
      accountPatch({ firstName: "Lute", county: "Buchanan", notes: "x" }, { firstName: "Lute", county: "", notes: "Nice house" }),
      { county: null, notes: "Nice house" },
    );
  });

  it("whitespace alone is not a change", () => {
    assert.deepEqual(accountPatch({ lastName: "Atieh" }, { lastName: "Atieh " }), {});
  });

  it("never writes a phone, an email or a flag — those have their own paths", () => {
    const patch = accountPatch({}, { homePhone: "1", email: "a@b", taxExempt: true } as never);
    assert.deepEqual(patch, {});
  });
});

describe("the one Update button", () => {
  it("runs only the parts with something to do, in a safe order", () => {
    assert.deepEqual(updateSteps({ customFields: true, people: true, contact: true }), ["people", "contact", "customFields"]);
    assert.deepEqual(updateSteps({}), []);
  });

  it("says in words what is unsaved", () => {
    assert.equal(unsavedSummary({}), "No unsaved changes");
    assert.equal(unsavedSummary({ contact: true }), "Unsaved changes: phones and emails");
    assert.equal(unsavedSummary({ account: true, addresses: true, people: true }), "Unsaved changes: details and addresses");
  });
});
