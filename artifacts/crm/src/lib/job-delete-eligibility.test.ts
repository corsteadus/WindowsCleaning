import assert from "node:assert/strict";
import test from "node:test";

import { canOfferPermanentJobDelete } from "./job-delete-eligibility.ts";

test("completed jobs never offer permanent deletion regardless of status casing", () => {
  for (const status of ["completed", "Completed", " COMPLETED "]) {
    assert.equal(canOfferPermanentJobDelete({
      canManageJobs: true,
      status,
      isDeleteProtected: false,
    }), false);
  }
});

test("legacy and invoice_jobs protection both suppress permanent deletion", () => {
  for (const protectedByInvoice of [true, true]) {
    assert.equal(canOfferPermanentJobDelete({
      canManageJobs: true,
      status: "scheduled",
      isDeleteProtected: protectedByInvoice,
    }), false);
  }
});

test("missing protection state fails closed after a fresh detail load", () => {
  assert.equal(canOfferPermanentJobDelete({
    canManageJobs: true,
    status: "scheduled",
    isDeleteProtected: undefined,
  }), false);
});

test("only jobs.manage users can delete an explicitly unprotected noncompleted job", () => {
  assert.equal(canOfferPermanentJobDelete({
    canManageJobs: false,
    status: "scheduled",
    isDeleteProtected: false,
  }), false);
  assert.equal(canOfferPermanentJobDelete({
    canManageJobs: true,
    status: "scheduled",
    isDeleteProtected: false,
  }), true);
});