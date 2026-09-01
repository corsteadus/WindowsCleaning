import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../pages/Dashboard.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/Layout.tsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../pages/Customers.tsx", import.meta.url), "utf8");

test("Prospects are the user-facing navigation surface while legacy lead routes remain compatible", () => {
  assert.match(layout, /href: "\/prospects",\s+label: "Prospects"/);
  assert.doesNotMatch(layout, /label: "Leads"/);
  assert.match(app, /path="\/prospects"/);
  assert.match(app, /path="\/prospects\/:id"/);
  assert.match(app, /path="\/leads\/:id"/);
  assert.match(app, /path="\/leads"/);
});

test("standalone Email and Payments navigation and dashboard creation shortcuts are removed", () => {
  assert.doesNotMatch(layout, /label: "Email"/);
  assert.doesNotMatch(layout, /label: "Payments"/);
  assert.doesNotMatch(dashboard, />New Customer</);
  assert.doesNotMatch(dashboard, />New Estimate</);
  assert.match(dashboard, />Create Job</);
});

test("Prospect creation reuses the full canonical account form and Prospect API", () => {
  assert.match(accounts, /mode === "prospects"/);
  assert.match(accounts, /useCreateProspect/);
  assert.match(accounts, /useListProspectDuplicateCandidates/);
  assert.match(accounts, /lifecycleStatus: isProspect \? "prospect" : "customer"/);
});