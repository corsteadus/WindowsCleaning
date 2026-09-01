import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("customer operations hub UI", () => {
  it("commits accepted initial scheduling through the atomic contract", async () => {
    const source = await readFile(new URL("./Customers.tsx", import.meta.url), "utf8");
    assert.match(source, /createCustomerWithInitialJob/);
    assert.match(source, /accepted: true/);
    assert.match(source, /Customer, contact, property, ownership, and job are saved together or not at all/);
    assert.match(source, /Idempotency/);
    assert.match(source, /useListActiveTeamUsers/);
    assert.match(source, /Assigned Team Members/);
    assert.doesNotMatch(source, /Comma-separated assigned user IDs/);
  });

  it("keeps estimates, split job history, invoices, payments, files and communications customer-centered", async () => {
    const source = await readFile(new URL("./CustomerDetail.tsx", import.meta.url), "utf8");
    for (const label of ["Properties", "Scheduled & active", "Completed", "New Estimate", "Invoices", "Payments", "Files", "Communications", "Activity"]) {
      assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(source, /\/quotes\/new\?customerId=/);
    assert.match(source, /\/invoices\/\$\{allocation\.invoiceId\}/);
  });

  it("records and displays payment history inside invoice detail", async () => {
    const source = await readFile(new URL("./InvoiceDetail.tsx", import.meta.url), "utf8");
    assert.match(source, /InvoicePaymentHistory/);
    assert.match(source, /\/api\/payments\?invoiceId=/);
    assert.match(source, /Record & allocate to invoice/);
    assert.match(source, /Idempotency-Key/);
    assert.match(source, /InvoiceCommunications/);
    assert.match(source, /relatedType: "invoice"/);
    assert.match(source, /Send safely & record history/);
  });
});