import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCustomerArray } from "./customer-list.ts";

interface MinCustomer { id: number; firstName: string }

describe("extractCustomerArray", () => {
  // ── absent / non-object inputs ────────────────────────────────────────────

  it("returns [] for undefined", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>(undefined), []);
  });

  it("returns [] for null", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>(null), []);
  });

  it("returns [] for a string", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>("string"), []);
  });

  it("returns [] for a number", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>(42), []);
  });

  // ── array shape (generated-type contract) ─────────────────────────────────

  it("returns the array directly when the response IS an array", () => {
    const arr: MinCustomer[] = [
      { id: 1, firstName: "Alice" },
      { id: 2, firstName: "Bob" },
    ];
    assert.deepEqual(extractCustomerArray<MinCustomer>(arr), arr);
  });

  it("returns [] for an empty array", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>([]), []);
  });

  // ── paginated envelope shape (actual runtime API response) ─────────────────

  it("extracts .customers from a paginated envelope", () => {
    const payload = {
      customers: [{ id: 3, firstName: "Carol" }, { id: 4, firstName: "Dave" }],
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
    assert.deepEqual(extractCustomerArray<MinCustomer>(payload), payload.customers);
  });

  it("returns [] when the envelope has no .customers key", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>({ total: 0 }), []);
  });

  it("returns [] when .customers is undefined in the envelope", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>({ customers: undefined }), []);
  });

  it("returns [] for an empty .customers array in the envelope", () => {
    assert.deepEqual(extractCustomerArray<MinCustomer>({ customers: [] }), []);
  });

  // ── single-customer search results ────────────────────────────────────────

  it("handles a single-item customers array", () => {
    const payload = { customers: [{ id: 5, firstName: "Eve" }], total: 1 };
    assert.deepEqual(extractCustomerArray<MinCustomer>(payload), [{ id: 5, firstName: "Eve" }]);
  });
});
