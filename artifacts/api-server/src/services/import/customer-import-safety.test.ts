import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { customerImportProvenanceTable } from "@workspace/db";
import {
  customerContactFromNormalized,
  normalizeImportIdentity,
  previewCustomerImportRows,
} from "./customer-import-safety.ts";

function fakeExecutor(options: {
  provenance?: { customerId: number } | null;
  customers?: any[];
}) {
  const provenance = options.provenance ?? null;
  const customers = options.customers ?? [];
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows: any[] = table === customerImportProvenanceTable
            ? (provenance ? [{
                sourceSystem: "customer_factor",
                externalRecordId: "cf-1",
                customerId: provenance.customerId,
              }] : [])
            : customers;
          Object.assign(rows, { limit: async () => rows });
          return rows;
        },
      }),
    }),
  } as any;
}

describe("future customer import safety preview", () => {
  it("reports missing external identity without pretending retry idempotency exists", async () => {
    const [preview] = await previewCustomerImportRows(
      fakeExecutor({}),
      "customer_factor",
      [{ firstName: "New", lastName: "Person", email: "new@example.com" }],
    );

    assert.equal(preview?.decision, "create");
    assert.equal(preview?.idempotencyAvailable, false);
    assert.match(preview?.idempotencyWarning ?? "", /idempotency is unavailable/);
  });

  it("returns all strong candidates without exposing submitted contact values", async () => {
    const [preview] = await previewCustomerImportRows(
      fakeExecutor({
        customers: [{
          id: 17,
          firstName: "Existing",
          lastName: "Person",
          companyName: "Existing Co",
          email: "same@example.com",
          phone: null,
          lifecycleStatus: "customer",
          clientType: "residential",
        }],
      }),
      "customer_factor",
      [{
        firstName: "New",
        lastName: "Person",
        email: "same@example.com",
        externalId: "cf-2",
      }],
    );

    assert.equal(preview?.decision, "requires_review");
    assert.deepEqual(preview?.candidates.map((candidate) => candidate.id), [17]);
    assert.equal("email" in (preview?.candidates[0] ?? {}), false);
  });

  it("treats an existing source/external pair as an idempotent skip", async () => {
    const [preview] = await previewCustomerImportRows(
      fakeExecutor({ provenance: { customerId: 23 } }),
      "customer_factor",
      [{ firstName: "Retry", lastName: "Row", externalId: "cf-1" }],
    );

    assert.equal(preview?.decision, "idempotent_skip");
    assert.equal(preview?.existingCustomerId, 23);
  });

  it("normalizes source identities and all supported contact fields", () => {
    assert.equal(normalizeImportIdentity("  cf-42  "), "cf-42");
    assert.deepEqual(
      customerContactFromNormalized({
        email: "person@example.com",
        phone: "555-0100",
        homePhone: "555-0101",
        workPhone: "555-0102",
        cellPhone: "555-0103",
        altPhone: "555-0104",
        alternatePhone: "555-0105",
      }),
      {
        email: "person@example.com",
        phone: "555-0100",
        homePhone: "555-0101",
        workPhone: "555-0102",
        cellPhone: "555-0103",
        altPhone: "555-0104",
        alternatePhone: "555-0105",
      },
    );
  });
});