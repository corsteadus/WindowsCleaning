// Kyle's Prospect Profile Notes #15, #16 and #22. Source-level guards in the
// style of the other page tests here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const quickAdd = read("../components/QuickAddService.tsx");
const servicePicker = read("../components/ServicePickerDialog.tsx");
const quoteNew = read("./QuoteNew.tsx");
const jobNew = read("./JobNew.tsx");
const services = read("./Services.tsx");
const detail = read("./CustomerDetail.tsx");
const customers = read("./Customers.tsx");

test("#22 the quick-add writes to the Service Catalog and refreshes it", () => {
  assert.match(quickAdd, /useCreateService\(/);
  assert.match(quickAdd, /setQueryData<Service\[\]>\(getListServicesQueryKey\(\)/);
  assert.match(quickAdd, /serviceIdempotencyHeaders\(idempotencyKey\)/);
});

test("#22 the quick-add and the catalogue page build the body the same way", () => {
  assert.match(quickAdd, /serviceDraftToBody\(draft\)/);
  assert.match(services, /serviceDraftToBody\(draft\)/);
  assert.doesNotMatch(services, /unit: pricing\[2\]/, "the catalogue page should not keep its own copy");
});

test("#22 the quick-add is offered only to people who may manage services", () => {
  assert.match(quickAdd, /hasClientCapability\(user, "services\.manage"\)/);
});

test("#22 the quick-add never renders a <form>, because the job form contains it", () => {
  const code = quickAdd.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /<form[\s>]/);
  assert.match(quickAdd, /type="button" size="sm" onClick=\{submit\}/);
});

test("#22 a service can be added from the estimate's picker and from the job form", () => {
  // The picker moved out of QuoteNew on 2026-10-04 so the quote page could use
  // the same one; the quick-add inside it is what #22 is about.
  assert.match(servicePicker, /<QuickAddService\s+onCreated=\{\(service\) => onAdd\(service\)\}/);
  assert.match(quoteNew, /<ServicePickerDialog/);
  assert.match(jobNew, /<QuickAddService/);
  assert.match(jobNew, /setServiceType\(service\.name\)/);
});

test("#16 prospects get New Estimate too, in the header and in the Quotes tab", () => {
  assert.match(detail, /customer\.lifecycleStatus === "prospect"/);
  assert.match(detail, /\{canQuoteThisAccount && \(\s*<button[\s\S]{0,400}New Estimate/);
  // The Estimates view is components/ProfileEstimates.tsx since 2026-10-24.
  assert.match(detail, /<EstimatesView[\s\S]{0,200}canCreate=\{canQuoteThisAccount\}/);
  assert.match(read("../components/ProfileEstimates.tsx"), /href=\{`\/quotes\/new\?customerId=\$\{customerId\}`\}/);
});

// #15 was first built as a jump to the estimate page after saving. Kyle's
// Video 3 showed he meant the estimate on the same form, saved with the
// prospect (piece B2, 2026-10-23); the estimate page keeps its own link.
test("#15 the estimate is booked on the Add Prospect form itself", () => {
  assert.match(customers, /<IntakeEstimate/);
  assert.match(customers, /Create Prospect & Save Estimate/);
  assert.match(customers, /\.\.\.\(estimate \? \{ estimate \} : \{\}\),/);
  assert.doesNotMatch(customers, /\/quotes\/new\?customerId=\$\{created\.id\}&schedule=estimate/);
  assert.match(quoteNew, /get\("schedule"\) === "estimate"/);
  assert.match(quoteNew, /id="estimate-appointment"/);
});

test("Save and email waits until every service is priced", () => {
  assert.match(customers, /const blocker = emailBlocker\(estimateLines, firstEmail\);/);
  assert.match(customers, /disabled=\{Boolean\(blocker\) \|\|/);
});
