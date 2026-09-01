import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findStrongDuplicateCandidatesFromCustomers,
  normalizeEmail,
  normalizePhone,
  type DuplicateCustomerContact,
} from "./lead-duplicate-candidates.ts";

function customer(
  id: number,
  overrides: Partial<DuplicateCustomerContact> = {},
): DuplicateCustomerContact {
  return {
    id,
    firstName: "Existing",
    lastName: "Customer",
    companyName: null,
    email: null,
    phone: null,
    ...overrides,
  };
}

describe("lead duplicate candidate normalization", () => {
  it("normalizes full email values", () => {
    assert.equal(normalizeEmail("  PERSON@Example.COM "), "person@example.com");
    assert.equal(normalizeEmail("  "), null);
  });

  it("normalizes formatted phone values and ignores short fragments", () => {
    assert.equal(normalizePhone("+1 (555) 010-1234"), "15550101234");
    assert.equal(normalizePhone("555-0100"), "5550100");
    assert.equal(normalizePhone("123"), null);
  });
});

describe("strong lead duplicate candidates", () => {
  it("finds an exact normalized email candidate", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      { email: " LEAD@EXAMPLE.COM ", phone: null },
      [customer(1, { email: "lead@example.com" })],
    );

    assert.deepEqual(candidates.map(candidate => candidate.matchTypes), [["email"]]);
  });

  it("finds an exact normalized phone candidate across customer phone fields", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      { email: null, phone: "(555) 010-1234" },
      [customer(1, { cellPhone: "5550101234" })],
    );

    assert.deepEqual(candidates.map(candidate => candidate.matchTypes), [["phone"]]);
  });

  it("checks every supported proposed phone field and returns all matching accounts", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      {
        email: null,
        homePhone: "(555) 010-1111",
        workPhone: "(555) 010-2222",
        cellPhone: "(555) 010-3333",
        altPhone: "(555) 010-4444",
        alternatePhone: "(555) 010-5555",
      },
      [
        customer(1, { phone: "5550101111" }),
        customer(2, { phone: "5550102222" }),
        customer(3, { phone: "5550103333" }),
        customer(4, { phone: "5550104444" }),
        customer(5, { phone: "5550105555" }),
      ],
    );

    assert.deepEqual(candidates.map(candidate => candidate.id), [1, 2, 3, 4, 5]);
    assert.ok(candidates.every(candidate => candidate.matchTypes.includes("phone")));
  });

  it("returns all candidates when email and phone point to different accounts", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      { email: "lead@example.com", phone: "5550101234" },
      [
        customer(1, { email: "lead@example.com" }),
        customer(2, { phone: "5550101234" }),
      ],
    );

    assert.deepEqual(candidates.map(candidate => candidate.id), [1, 2]);
  });

  it("reports both match types for one account without duplicating the candidate", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      { email: "lead@example.com", phone: "5550101234" },
      [customer(1, { email: "lead@example.com", phone: "5550101234" })],
    );

    assert.deepEqual(candidates[0]?.matchTypes, ["email", "phone"]);
  });

  it("does not treat names, companies, or addresses as duplicate signals", () => {
    const candidates = findStrongDuplicateCandidatesFromCustomers(
      { email: "new@example.com", phone: "5550109999" },
      [customer(1, {
        firstName: "Same",
        lastName: "Person",
        companyName: "Same Company",
        email: "different@example.com",
        phone: "5550101111",
      })],
    );

    assert.deepEqual(candidates, []);
  });
});