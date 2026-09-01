import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("job workflow controls use canonical capability checks while field work remains available", async () => {
  const [dashboard, schedule, job, jobs, customer, app] = await Promise.all([
    readFile(new URL("./Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("./Schedule.tsx", import.meta.url), "utf8"),
    readFile(new URL("./JobDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("./Jobs.tsx", import.meta.url), "utf8"),
    readFile(new URL("./CustomerDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../App.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /hasClientCapability\(user, "schedule\.manage"\)/);
  assert.match(schedule, /hasClientCapability\(user, "schedule\.manage"\)/);
  assert.match(schedule, /canManageSchedule && <Button/);
  assert.match(schedule, /canManageSchedule && <button[\s\S]*Move/);

  assert.match(job, /hasClientCapability\(user, "jobs\.manage"\)/);
  assert.match(job, /hasClientCapability\(user, "schedule\.manage"\)/);
  assert.match(job, /getJobFinancialVisibility\(user\)/);
  assert.match(job, /hasClientCapability\(user, "invoices\.manage"\)/);
  assert.match(job, /enabled: canViewInvoices/);
  assert.match(job, /canManageJob && job\.status === "scheduled"/);
  assert.match(job, /canManageSchedule && isActionable/);
  assert.match(job, /\{canViewJobValue && <div/);
  assert.match(job, /\{canViewInvoices && <div/);
  assert.match(job, /\{canViewLinkedQuote && linkedQuote/);
  assert.match(job, /invoices\.map\(\(invoice\)/);
  assert.doesNotMatch(job, /invoices\?\.\[0\]/);
  assert.equal((job.match(/canManageInvoices && isCompleted && !invoicesLoading && !hasLinkedInvoices/g) ?? []).length, 2);
  assert.match(job, /disabled=\{!canManageJob\}/);
  assert.match(jobs, /canSchedule && <button/);
  assert.match(jobs, /showAmount && <span/);
  assert.match(customer, /function ReadOnlyContacts/);
  assert.match(customer, /function ReadOnlyProperties/);
  assert.match(customer, /tab\.id !== "files" \|\| canManageCustomer/);
  assert.match(customer, /tab\.id !== "activity" \|\| canManageCustomer/);
  assert.match(app, /queryClient\.clear\(\)/);
  assert.match(app, /location === "\/"/);
});