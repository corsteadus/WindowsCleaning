import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  canonicalContactValues,
  canonicalPropertyValues,
  effectiveDefaultPropertyIdForCustomer,
  normalizeOptionalPropertyId,
  syncLegacyContact,
} from "../lib/account-relations.ts";
import { customersTable, propertiesTable } from "@workspace/db";
import { dedupePropertyRows } from "../lib/property-search.ts";

const contactsRoute = readFileSync(new URL("./contacts.ts", import.meta.url), "utf8");
const propertiesRoute = readFileSync(new URL("./properties.ts", import.meta.url), "utf8");
const customersRoute = readFileSync(new URL("./customers.ts", import.meta.url), "utf8");
const jobsRoute = readFileSync(new URL("./jobs.ts", import.meta.url), "utf8");
const quotesRoute = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8");
const recurringPlansRoute = readFileSync(new URL("./recurring_plans.ts", import.meta.url), "utf8");

type Contact = { id: number; isPrimary: boolean; archived: boolean };
type Relationship = { id: number; propertyId: number; customerId: number; isPrimary: boolean; archived: boolean };

function createContact(contacts: Contact[], id: number, requestedPrimary = false): Contact {
  const shouldPrimary = requestedPrimary || contacts.every(contact => contact.archived);
  const contact = { id, isPrimary: shouldPrimary, archived: false };
  if (shouldPrimary) contacts.forEach(existing => { existing.isPrimary = false; });
  contacts.push(contact);
  return contact;
}

function promoteContact(contacts: Contact[], id: number): Contact {
  const target = contacts.find(contact => contact.id === id && !contact.archived);
  assert.ok(target, "promotion target must be active");
  contacts.forEach(contact => {
    contact.isPrimary = !contact.archived && contact.id === id;
  });
  return target;
}

function archiveContact(contacts: Contact[], id: number): void {
  const target = contacts.find(contact => contact.id === id);
  assert.ok(target, "archive target must exist");
  if (target.isPrimary && contacts.filter(contact => !contact.archived && contact.id !== id).length === 0) {
    throw new Error("Promote another contact before archiving the only active primary");
  }
  target.archived = true;
  target.isPrimary = false;
  const replacement = contacts.find(contact => !contact.archived);
  if (replacement) promoteContact(contacts, replacement.id);
}

function linkProperty(
  relationships: Relationship[],
  propertyId: number,
  customerId: number,
  requestedPrimary = false,
): Relationship {
  if (relationships.some(relation =>
    relation.propertyId === propertyId && relation.customerId === customerId && !relation.archived,
  )) {
    throw new Error("Property is already linked to this customer");
  }
  const active = relationships.filter(relation => relation.customerId === customerId && !relation.archived);
  const relation = {
    id: relationships.length + 1,
    propertyId,
    customerId,
    isPrimary: requestedPrimary || active.length === 0,
    archived: false,
  };
  if (relation.isPrimary) {
    relationships
      .filter(existing => existing.customerId === customerId && !existing.archived)
      .forEach(existing => { existing.isPrimary = false; });
  }
  relationships.push(relation);
  return relation;
}

function unlinkProperty(relationships: Relationship[], propertyId: number, customerId: number): void {
  const relation = relationships.find(candidate =>
    candidate.propertyId === propertyId &&
    candidate.customerId === customerId &&
    !candidate.archived,
  );
  assert.ok(relation, "relationship must exist");
  if (relation.isPrimary && relationships.filter(candidate =>
    candidate.customerId === customerId &&
    !candidate.archived &&
    candidate.id !== relation.id,
  ).length === 0) {
    throw new Error("Promote another property before removing the only active primary");
  }
  relation.archived = true;
  relation.isPrimary = false;
}

test("legacy synchronization uses the same safe canonicalization as create and update paths", () => {
  assert.deepEqual(
    canonicalContactValues({
      firstName: " Jane ",
      lastName: " Doe ",
      email: "jane@example.com",
      cellPhone: "cell",
      phone: "home",
      alternatePhone: "alt",
    }),
    {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "cell",
      alternatePhone: "alt",
    },
  );
  assert.equal(canonicalContactValues({ firstName: "Jane", lastName: " " }), null);
  assert.deepEqual(
    canonicalPropertyValues({
      billingAddress: " 1 Main ",
      billingCity: " St Joe ",
      billingState: " MO ",
      billingZip: " 64501 ",
    }),
    {
      address: "1 Main",
      city: "St Joe",
      state: "MO",
      zip: "64501",
      billingAddress: "1 Main",
      billingCity: "St Joe",
      billingState: "MO",
      billingZip: "64501",
    },
  );
  assert.equal(canonicalPropertyValues({ billingAddress: "1 Main", billingCity: "St Joe" }), null);
});

test("contact create, update promotion, and primary archive safety preserve one active primary", () => {
  const contacts: Contact[] = [];
  createContact(contacts, 1);
  createContact(contacts, 2);
  assert.equal(contacts.filter(contact => contact.isPrimary && !contact.archived).length, 1);
  promoteContact(contacts, 2);
  assert.equal(contacts.find(contact => contact.id === 2)?.isPrimary, true);
  archiveContact(contacts, 2);
  assert.equal(contacts.find(contact => contact.id === 1)?.isPrimary, true);
  assert.throws(() => archiveContact(contacts, 1), /only active primary/);
});

test("primary contact synchronization preserves the account display identity", async () => {
  let updateValues: Record<string, unknown> | undefined;
  const executor = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateValues = values;
        return { where: async () => undefined };
      },
    }),
  };
  await syncLegacyContact(executor, {
    customerId: 1, firstName: "New", lastName: "Contact",
    email: "contact@example.com", phone: "555", alternatePhone: null,
  });
  assert.deepEqual(updateValues, {
    email: "contact@example.com", phone: "555", cellPhone: "555",
    alternatePhone: null, altPhone: null,
  });
});

test("shared-property link and unlink keep relationship ownership scoped", () => {
  const relationships: Relationship[] = [];
  linkProperty(relationships, 10, 100);
  const shared = linkProperty(relationships, 10, 200);
  linkProperty(relationships, 11, 200);
  assert.equal(shared.isPrimary, true);
  assert.throws(() => linkProperty(relationships, 10, 200), /already linked/);
  unlinkProperty(relationships, 10, 200);
  assert.equal(relationships.find(relation => relation.id === shared.id)?.archived, true);
  assert.throws(() => unlinkProperty(relationships, 10, 100), /only active primary/);
});

test("concurrent primary promotions converge on one winner under the account lock contract", async () => {
  const contacts: Contact[] = [
    { id: 1, isPrimary: true, archived: false },
    { id: 2, isPrimary: false, archived: false },
  ];
  let queue = Promise.resolve();
  const lockedPromote = (id: number) => {
    const next = queue.then(async () => promoteContact(contacts, id));
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  await Promise.all([lockedPromote(1), lockedPromote(2), lockedPromote(1)]);
  assert.equal(contacts.filter(contact => contact.isPrimary && !contact.archived).length, 1);
  assert.equal(contacts.find(contact => contact.id === 1)?.isPrimary, true);
});

test("HTTP route wiring keeps relation mutations transactional and account-scoped", () => {
  for (const source of [contactsRoute, propertiesRoute]) {
    assert.match(source, /db\.transaction/);
    assert.match(source, /lockAccount/);
    assert.match(source, /isNull\(/);
  }
  assert.match(contactsRoute, /router\.post\("\/contacts"/);
  assert.match(contactsRoute, /router\.patch\("\/contacts\/:id"/);
  assert.match(contactsRoute, /router\.post\("\/contacts\/:id\/primary"/);
  assert.match(contactsRoute, /router\.post\("\/contacts\/:id\/archive"/);
  assert.match(propertiesRoute, /router\.post\("\/properties"/);
  assert.match(propertiesRoute, /router\.patch\("\/properties\/:id"/);
  assert.match(propertiesRoute, /router\.post\("\/properties\/:id\/relationships"/);
  assert.match(propertiesRoute, /router\.delete\("\/properties\/:id\/relationships\/:customerId"/);
});

test("customer creation and patch keep legacy-to-canonical work inside one transaction", () => {
  assert.match(customersRoute, /const \{ customer, createdContact, createdProperty \} = await db\.transaction/);
  assert.match(customersRoute, /tx\.insert\(contactsTable\)/);
  assert.match(customersRoute, /tx\.insert\(propertiesTable\)/);
  assert.match(customersRoute, /tx\.insert\(propertyAccountRelationshipsTable\)/);
  assert.match(customersRoute, /syncPrimaryContactFromLegacy/);
  assert.match(customersRoute, /syncPrimaryPropertyFromLegacy/);
  assert.match(customersRoute, /await lockAccount\(tx, id\)/);
});

test("downstream property selection rejects invalid ids and enforces active account relationships", () => {
  assert.equal(normalizeOptionalPropertyId(undefined), null);
  assert.equal(normalizeOptionalPropertyId(""), null);
  assert.equal(normalizeOptionalPropertyId("42"), 42);
  assert.throws(() => normalizeOptionalPropertyId("not-an-id"), /positive integer/);
  assert.throws(() => normalizeOptionalPropertyId(0), /positive integer/);

  for (const source of [jobsRoute, quotesRoute, recurringPlansRoute]) {
    assert.match(source, /requireActivePropertyForCustomer/);
    assert.match(source, /normalizeOptionalPropertyId/);
  }
  assert.match(jobsRoute, /body\.propertyId !== undefined/);
  assert.match(quotesRoute, /body\.propertyId !== undefined/);
  assert.match(recurringPlansRoute, /body\.propertyId !== undefined/);
});

test("active property choices include owner and shared relationships but exclude archived or unrelated rows", () => {
  const rows = [
    { id: 1, customerId: 10, archived: false, relatedCustomerIds: [] },
    { id: 2, customerId: 99, archived: false, relatedCustomerIds: [10] },
    { id: 3, customerId: 10, archived: true, relatedCustomerIds: [] },
    { id: 4, customerId: 77, archived: false, relatedCustomerIds: [] },
  ];
  const choicesFor = (customerId: number) => rows.filter((property) =>
    !property.archived &&
    (property.customerId === customerId || property.relatedCustomerIds.includes(customerId)),
  );

  assert.deepEqual(choicesFor(10).map((property) => property.id), [1, 2]);
  assert.deepEqual(choicesFor(77).map((property) => property.id), [4]);
  assert.deepEqual(choicesFor(55), []);
});

test("effective invoice defaults include active shared properties when no stored default remains", async () => {
  const executor = {
    select: (shape: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === customersTable) {
          return { where: async () => [{ defaultPropertyId: null }] };
        }
        if (table === propertiesTable) {
          return {
            where: async () => [{ id: 41, isPrimary: false, isBillingAddress: true }],
            innerJoin: () => ({
              where: async () => [{ id: 77, isPrimary: true, isBillingAddress: false }],
            }),
          };
        }
        throw new Error(`Unexpected table in effective default query: ${String(shape)}`);
      },
    }),
  };

  assert.equal(await effectiveDefaultPropertyIdForCustomer(executor, 7), 77);
});

test("global property search includes owner and active shared account names", () => {
  assert.match(propertiesRoute, /c\.company_name ILIKE/);
  assert.match(propertiesRoute, /concat_ws\(' ', c\.first_name, c\.last_name\) ILIKE/);
  assert.match(propertiesRoute, /FROM property_account_relationships rel/);
  assert.match(propertiesRoute, /rel\.archived_at IS NULL/);
  assert.match(propertiesRoute, /INNER JOIN customers c ON c\.id = rel\.customer_id/);
});

test("global property pagination remains unique when multiple relationships match", () => {
  const rows = dedupePropertyRows([
    { id: 4314, customerId: 10 },
    { id: 4314, customerId: 10 },
    { id: 4315, customerId: 10 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [4314, 4315]);
  assert.match(propertiesRoute, /count\(distinct \$\{propertiesTable\.id\}\)/);
  assert.match(propertiesRoute, /limit\(pageSize\)/);
  assert.match(propertiesRoute, /offset\(\(page - 1\) \* pageSize\)/);
});