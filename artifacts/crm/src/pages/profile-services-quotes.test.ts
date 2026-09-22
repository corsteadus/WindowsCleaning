// Kyle's Prospect Profile Notes #15, #16 and #22. Source-level guards in the
// style of the other page tests here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const quickAdd = read("../components/QuickAddService.tsx");
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
  assert.match(quoteNew, /<QuickAddService\s+onCreated=\{\(service\) => onAdd\(service\)\}/);
  assert.match(jobNew, /<QuickAddService/);
  assert.match(jobNew, /setServiceType\(service\.name\)/);
});

test("#16 prospects get New Estimate too, in the header and in the Quotes tab", () => {
  assert.match(detail, /customer\.lifecycleStatus === "prospect"/);
  assert.match(detail, /!isEditing && canQuoteThisAccount && \(/);
  assert.match(detail, /<QuotesTab quotes=\{customer\.quotes \?\? \[\]\} customerId=\{customer\.id\} canCreate=\{canQuoteThisAccount\} \/>/);
  const tab = detail.slice(detail.indexOf("function QuotesTab("));
  assert.match(tab.slice(0, 1200), /href=\{`\/quotes\/new\?customerId=\$\{customerId\}`\}/);
});

test("#15 creating a prospect carries on into its estimate with the appointment open", () => {
  assert.match(customers, /navigate\(`\/quotes\/new\?customerId=\$\{created\.id\}&schedule=estimate`\)/);
  assert.match(customers, /Create Prospect & Schedule Estimate/);
  assert.match(quoteNew, /get\("schedule"\) === "estimate"/);
  assert.match(quoteNew, /id="estimate-appointment"/);
});
