import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveInvoiceJobReference } from "../lib/invoice-job-reference.ts";

const invoices = readFileSync(new URL("./Invoices.tsx", import.meta.url), "utf8");
const invoiceDetail = readFileSync(new URL("./InvoiceDetail.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("./Customers.tsx", import.meta.url), "utf8");
const customerDetail = readFileSync(new URL("./CustomerDetail.tsx", import.meta.url), "utf8");
const jobDetail = readFileSync(new URL("./JobDetail.tsx", import.meta.url), "utf8");
const financialPermissions = readFileSync(new URL("./FinancialPermissions.tsx", import.meta.url), "utf8");

test("voided invoices render as voided while the Draft filter and counts remain distinct", () => {
  assert.match(invoices, /voided:\s*\{\s*label:\s*"Voided"/);
  assert.match(invoices, /const cfg = invoiceStatusConfig\(inv\.status\)/);
  assert.doesNotMatch(invoices, /STATUS_CFG\[inv\.status\]\s*\?\?\s*STATUS_CFG\.draft/);
  assert.match(invoices, /"credited", "voided", "bad_debt"/);
  assert.match(invoices, /\+\s*\(stats\.voided \?\? 0\)/);
  assert.match(invoices, /draft:\s+stats\.draft/);
  assert.match(invoices, /const isClosed\s*=\s*\["paid", "voided", "credited"\]/);
});

test("returned credit and partial statuses have consistent safe invoice labels", () => {
  for (const status of ["partial", "partially_credited", "credited", "voided"]) {
    assert.match(invoices, new RegExp(`${status}:`));
    assert.match(invoiceDetail, new RegExp(`${status}:`));
  }
  assert.match(invoices, /label:\s*"Partially Paid"/);
  assert.match(invoices, /label:\s*status\.trim\(\)/);
  assert.doesNotMatch(invoiceDetail, /STATUS_CFG\[invoice\.status\]\s*\?\?\s*STATUS_CFG\.draft/);
});

test("invoice detail links existing jobs but labels deleted legacy jobs without navigation", () => {
  assert.deepEqual(resolveInvoiceJobReference(8, "JOB-0008", [{ id: 8, jobNumber: "JOB-0008" }]), {
    kind: "available",
    id: 8,
    label: "JOB-0008",
    href: "/jobs/8",
  });
  assert.deepEqual(resolveInvoiceJobReference(8, null, []), {
    kind: "unavailable",
    id: 8,
    label: "Job #8 — unavailable/deleted",
  });
  assert.deepEqual(resolveInvoiceJobReference(8, "STALE-0008", []), {
    kind: "unavailable",
    id: 8,
    label: "Job #8 — unavailable/deleted",
  });
  assert.deepEqual(resolveInvoiceJobReference(8, null, [{ id: 8, jobNumber: null }]), {
    kind: "available",
    id: 8,
    label: "Job #8",
    href: "/jobs/8",
  });
  assert.match(invoiceDetail, /primaryJobReference\.kind === "available"/);
  assert.match(invoiceDetail, /navigate\(primaryJobReference\.href\)/);
  assert.match(invoiceDetail, /primaryJobReference\.kind === "unavailable"/);
  assert.doesNotMatch(invoiceDetail, /navigate\(`\/jobs\/\$\{invoice\.jobId\}`\)/);
  assert.match(invoiceDetail, /Correction history/);
  assert.match(invoiceDetail, /window\.print\(\)/);
});

test("property counts include only active persisted property rows", () => {
  assert.match(customerDetail, /customer\.properties\.filter\(\(property\) => !property\.archivedAt\)\.length/);
  assert.match(customerDetail, /const totalCount = activeProperties\.length/);
  assert.match(customerDetail, /Compatibility information only\.[\s\S]*not included in the Properties count/);
  assert.doesNotMatch(customerDetail, /customer\.properties\.length \+ \(hasBilling/);
});

test("same-page header searches resync q and retain authorization-scoped keys", () => {
  assert.match(customers, /new URLSearchParams\(window\.location\.search\)\.get\("q"\)/);
  assert.match(customers, /const urlSearch = useSearch\(\)/);
  assert.match(customers, /\}, \[urlSearch\]\)/);
  assert.match(customers, /setDebouncedSearch\(nextQuery\)/);
  assert.match(customers, /customerListSearchLocation\(\s*window\.location\.pathname,\s*urlSearch,\s*search/);
  assert.match(customers, /navigate\(nextLocation, \{ replace: true \}\)/);
  assert.match(customers, /customerListSearchLocation\(pathname, urlSearch, ""\), \{ replace: true \}/);
  assert.match(customers, /authScopedQueryKey\(user, \[mode, "paginated", page, search, accountType, lifecycleStatus\]\)/);
});

test("job assignments never expose raw IDs and invoice generation remains explicit", () => {
  assert.doesNotMatch(jobDetail, /`Crew #\$\{job\.crewId\}`/);
  assert.doesNotMatch(jobDetail, /`User \$\{job\.assignedTechnicianUserId\}`/);
  assert.match(jobDetail, /Archived or unavailable crew/);
  assert.match(jobDetail, /Archived or unavailable technician/);
  assert.match(jobDetail, /"Generate Invoice"/);
  assert.match(jobDetail, /onClick=\{\(\) => changeStatus\("completed"\)\}/);
});

test("completed and invoice-linked jobs hide permanent deletion while eligible jobs retain server-checked wiring", () => {
  assert.match(jobDetail, /const isDeleteProtected = isCompleted \|\| job\.isDeleteProtected !== false/);
  assert.match(jobDetail, /canOfferPermanentJobDelete\(\{[\s\S]*canManageJobs: canManageJob/);
  assert.equal(jobDetail.match(/\{canDeleteJob && <button/g)?.length, 1);
  assert.match(jobDetail, /\{canDeleteJob && <Dialog/);
  assert.doesNotMatch(jobDetail, /\{canManageSchedule && <button[\s\S]{0,300}title="Delete job"/);
  assert.match(jobDetail, /Permanent deletion is unavailable for completed jobs or jobs with linked invoices/);
  assert.match(jobDetail, /deleteMutation\.mutate\(\{ id: jobId \}\)/);
});

test("financial permissions returns approval users to an allowed page", () => {
  assert.match(financialPermissions, /href="\/payments\/approvals"/);
  assert.doesNotMatch(financialPermissions, /href="\/settings"/);
});