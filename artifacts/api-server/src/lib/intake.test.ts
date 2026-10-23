import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { IntakeError, estimateLocationIds, intakeFlatFields, parseIntake, parseIntakeEstimate } from "./intake.ts";

const lute = { firstName: "Lute", lastName: "Atieh" };
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the intake — Kyle's Video 2", () => {
  it("no intake is no change at all", () => {
    assert.equal(parseIntake(undefined, lute), null);
    assert.equal(parseIntake(null, lute), null);
  });

  it("keeps the six phones with whose number each is", () => {
    const plan = parseIntake({
      phones: [
        { slot: "Cell", value: "816-555-0101" },
        { slot: "cell 2", value: "816-555-0102", owner: { firstName: "Lauren", lastName: "Atieh" } },
        { slot: "Home", value: "" },
      ],
    }, lute)!;
    assert.deepEqual(plan.phones.map((phone) => [phone.slot, phone.personKey]), [["Cell", null], ["Cell 2", "lauren atieh"]]);
    assert.deepEqual(plan.people.map((person) => person.firstName), ["Lauren"]);
  });

  it("one person named on a phone and an email is one person", () => {
    const lauren = { firstName: "Lauren", lastName: " Atieh " };
    const plan = parseIntake({
      phones: [{ slot: "Cell 2", value: "1", owner: lauren }],
      emails: [{ value: "lauren@corstead.us", owner: { firstName: "lauren", lastName: "atieh" } }],
    }, lute)!;
    assert.equal(plan.people.length, 1);
  });

  it("naming the account holder as the owner is the account holder, not a new person", () => {
    const plan = parseIntake({ phones: [{ slot: "Cell", value: "1", owner: { firstName: "LUTE", lastName: "atieh" } }] }, lute)!;
    assert.equal(plan.people.length, 0);
    assert.equal(plan.phones[0].personKey, null);
  });

  it("refuses a half-named person, an unknown phone, and the same phone twice", () => {
    assert.throws(() => parseIntake({ phones: [{ slot: "Cell", value: "1", owner: { firstName: "Lauren" } }] }, lute), IntakeError);
    assert.throws(() => parseIntake({ phones: [{ slot: "Pager", value: "1" }] }, lute), IntakeError);
    assert.throws(() => parseIntake({ phones: [{ slot: "Cell", value: "1" }, { slot: "Cell", value: "2" }] }, lute), IntakeError);
  });

  it("emails: invalid refused, repeats dropped, routing kept, General by default, None allowed", () => {
    assert.throws(() => parseIntake({ emails: [{ value: "not-an-email" }] }, lute), IntakeError);
    const plan = parseIntake({
      emails: [
        { value: "lute@corstead.us" },
        { value: "LUTE@corstead.us" },
        { value: "billing@corstead.us", purposes: ["billing", "nonsense"] },
        { value: "quiet@corstead.us", purposes: [] },
      ],
    }, lute)!;
    assert.deepEqual(plan.emails.map((email) => [email.value, email.purposes.join()]), [
      ["lute@corstead.us", "general"], ["billing@corstead.us", "billing"], ["quiet@corstead.us", ""],
    ]);
  });

  it("locations: up to three at creation, each complete, named by default", () => {
    const place = { address: "100 Main St", city: "Leawood", state: "KS", zip: "66209" };
    const plan = parseIntake({ locations: [{ ...place, name: "Mom's house" }, place, { name: "blank row" }] }, lute)!;
    assert.deepEqual(plan.locations.map((location) => location.name), ["Mom's house", "Location 3"]);
    assert.throws(() => parseIntake({ locations: [place, place, place] }, lute), /Up to 3 locations/);
    assert.throws(() => parseIntake({ locations: [{ name: "Lake", address: "1 Shore Rd" }] }, lute), /Lake needs city, state, zip/);
  });

  it("the flat columns follow the intake, so the duplicate check sees the same numbers", () => {
    const plan = parseIntake({
      phones: [{ slot: "Cell", value: "816-555-0101" }, { slot: "Cell 2", value: "816-555-0102" }],
      emails: [{ value: "lute@corstead.us" }, { value: "lauren@corstead.us" }],
      marketingSource: "Facebook",
    }, lute)!;
    assert.deepEqual(intakeFlatFields(plan), {
      homePhone: null, workPhone: null, cellPhone: "816-555-0101", altPhone: null, fax: null,
      email: "lute@corstead.us", source: "Facebook",
    });
  });
});

describe("both create paths write the intake in their own transaction", () => {
  const route = read("../routes/customers.ts");
  const adapter = read("./customer-initial-job-db-adapter.ts");

  // After the main property, so the extra locations come after it everywhere
  // they are listed in order. Found in the walkthrough.
  it("POST /customers and /prospects, in both branches, after the main property", () => {
    const write = "if (intake) extraLocationIds = (await writeIntake(tx, created, intake)).locationIds;";
    assert.equal(route.split(write).length - 1, 2);
    assert.ok(route.indexOf(write) > route.indexOf("set({ defaultPropertyId: createdProperty.id })"));
  });

  it("POST /customers/with-initial-job, after the main property", () => {
    assert.match(route, /afterPrimaryProperty: intake \? async \(tx, customer\) => \{ await writeIntake\(tx, customer, intake\); \} : undefined/);
    assert.match(adapter, /setDefaultProperty: async[\s\S]{0,400}if \(input\.afterPrimaryProperty\) await input\.afterPrimaryProperty\(tx, customer\);/);
  });

  it("the flat fields are taken from the intake before the duplicate check", () => {
    assert.equal((route.match(/normalizeCustomerFields\(intake \? \{ \.\.\.body, \.\.\.intakeFlatFields\(intake\) \} : body\)/g) ?? []).length, 2);
  });

  it("a retry with a different intake is not mistaken for the same request", () => {
    assert.equal((route.match(/\.\.\.\(intake \? \{ intake \} : \{\}\),/g) ?? []).length, 2);
  });
});

describe("the estimate on the Add form — Kyle's Video 3", () => {
  const both = { main: true, extraLocations: 1 };

  it("no estimate is no change", () => {
    assert.equal(parseIntakeEstimate(undefined, both), null);
  });

  it("a blank price stays blank, \"to be quoted\"; $0 is a price (Kyle, 2026-10-24); quantity defaults to 1", () => {
    const estimate = parseIntakeEstimate({ lines: [{ description: "Window cleaning", unitPrice: "" }, { description: "Screens", unitPrice: 0 }] }, both)!;
    assert.deepEqual([estimate.lines[0].unitPrice, estimate.lines[0].quantity, estimate.lines[0].location], [null, 1, 0]);
    assert.equal(estimate.lines[1].unitPrice, 0);
  });

  it("each line names its location; one that is not on the form is refused", () => {
    const estimate = parseIntakeEstimate({ lines: [{ description: "Gutters", location: 1 }] }, both)!;
    assert.equal(estimate.lines[0].location, 1);
    assert.throws(() => parseIntakeEstimate({ lines: [{ description: "Gutters", location: 2 }] }, both), /not on the form/);
    assert.throws(() => parseIntakeEstimate({ lines: [{ description: "Windows" }] }, { main: false, extraLocations: 0 }), /add the service address first/);
  });

  it("refuses an empty estimate, a negative price, and a zero quantity", () => {
    assert.throws(() => parseIntakeEstimate({ lines: [{ description: " " }] }, both), /at least one service/);
    assert.throws(() => parseIntakeEstimate({ lines: [{ description: "W", unitPrice: -5 }] }, both), IntakeError);
    assert.throws(() => parseIntakeEstimate({ lines: [{ description: "W", quantity: 0 }] }, both), IntakeError);
  });

  it("the appointment is booked at every location the lines are for, main first", () => {
    const estimate = parseIntakeEstimate({ lines: [
      { description: "Gutters", location: 1 }, { description: "Windows", location: 0 }, { description: "Screens", location: 1 },
    ] }, both)!;
    assert.deepEqual(estimateLocationIds(estimate, [501, 502]), [501, 502]);
  });

  it("the route creates the estimate in the profile's own transaction, and only for a new profile", () => {
    const route = read("../routes/customers.ts");
    assert.match(route, /if \(estimate && transactionOutcome\.kind === "created"\) \{[\s\S]{0,1600}createScheduledQuoteTx\(tx,[\s\S]{0,400}createQuoteTx\(tx, quote,/);
    assert.match(route, /hasCapability\(req\.user\?\.role, "quotes\.manage"\)[\s\S]{0,120}hasCapability\(req\.user\?\.role, "estimates\.schedule"\)/);
  });

  it("the estimate page's own booking uses the very same code", () => {
    const quotes = read("../routes/quotes.ts");
    assert.match(quotes, /const appointment = parseQuoteAppointment\(body\.appointment\);/);
    assert.match(quotes, /const committed = await createScheduledQuoteTx\(tx, \{/);
  });
});
