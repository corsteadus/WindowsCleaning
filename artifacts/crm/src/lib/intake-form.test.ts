import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_OWNER, INTAKE_PHONES, buildIntake, intakeProblems, namedPeople,
  type IntakeState,
} from "./intake-form.ts";

const lauren = { kind: "person" as const, firstName: "Lauren", lastName: "Atieh" };
const empty: IntakeState = { phones: {}, owners: {}, emails: [], locations: [], marketingSource: "" };
const place = { key: "l1", name: "Mom's house", address: "100 Main St", city: "Leawood", state: "KS", zip: "66209" };

describe("the Add form's intake — Kyle's Video 2", () => {
  it("offers his six phones, in his order", () => {
    assert.deepEqual(INTAKE_PHONES.map((phone) => phone.slot), ["Home", "Work", "Cell", "Cell 2", "Alt", "Fax"]);
  });

  it("sends nothing for an empty form", () => {
    assert.deepEqual(buildIntake(empty), { phones: [], emails: [], locations: [], marketingSource: null });
  });

  it("sends each phone with whose number it is; the account holder is null", () => {
    const intake = buildIntake({ ...empty, phones: { Cell: " 816-555-0101 ", "Cell 2": "816-555-0102", Home: "" }, owners: { "Cell 2": lauren } });
    assert.deepEqual(intake.phones, [
      { slot: "Cell", value: "816-555-0101", owner: null },
      { slot: "Cell 2", value: "816-555-0102", owner: { firstName: "Lauren", lastName: "Atieh" } },
    ]);
  });

  it("sends every email with its person and routing", () => {
    const intake = buildIntake({
      ...empty,
      emails: [
        { key: "e1", value: "lute@corstead.us", owner: ACCOUNT_OWNER, routing: "all" },
        { key: "e2", value: "lauren@corstead.us", owner: lauren, routing: "estimates" },
        { key: "e3", value: "  ", owner: ACCOUNT_OWNER, routing: "general" },
      ],
    });
    assert.deepEqual(intake.emails.map((email) => [email.value, email.owner?.firstName ?? null, email.purposes.join()]), [
      ["lute@corstead.us", null, "general,billing,estimates"], ["lauren@corstead.us", "Lauren", "estimates"],
    ]);
  });

  it("someone named once can be picked again, without typing her twice", () => {
    const people = namedPeople([lauren, { ...lauren, firstName: " lauren " }, ACCOUNT_OWNER, { kind: "person", firstName: "Half", lastName: "" }]);
    assert.deepEqual(people.map((person) => person.firstName), ["Lauren"]);
  });

  it("extra locations go with their names; a blank row is ignored", () => {
    const intake = buildIntake({ ...empty, locations: [place, { ...place, key: "l2", name: "", address: "", city: "", state: "", zip: "" }] });
    assert.deepEqual(intake.locations, [{ name: "Mom's house", address: "100 Main St", city: "Leawood", state: "KS", zip: "66209" }]);
  });

  it("says what is missing before anything is sent", () => {
    assert.deepEqual(intakeProblems({
      ...empty,
      phones: { Cell: "816" },
      owners: { Cell: { kind: "person", firstName: "Lauren", lastName: "" } },
      locations: [{ ...place, name: "Lake", city: "", zip: "" }],
    }), ["Cell phone: give the person's first and last name", "Lake needs city, zip"]);
    assert.deepEqual(intakeProblems({ ...empty, owners: { Cell: { kind: "person", firstName: "", lastName: "" } } }), [],
      "a half-named owner on an empty phone is not a problem");
  });

  it("the marketing source comes from the managed list", () => {
    assert.equal(buildIntake({ ...empty, marketingSource: "Facebook" }).marketingSource, "Facebook");
  });
});
