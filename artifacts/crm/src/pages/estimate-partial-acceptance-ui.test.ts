// Kyle 2026-09-24 #1 and #2: a checkbox on the left of every service line, the
// selection highlighted, and the Estimate Status module on the dashboard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const publicEstimate = readFileSync(fileURLToPath(new URL("./PublicEstimate.tsx", import.meta.url)), "utf8");
const dashboard = readFileSync(fileURLToPath(new URL("./Dashboard.tsx", import.meta.url)), "utf8");
const module_ = readFileSync(fileURLToPath(new URL("../components/EstimateStatusModule.tsx", import.meta.url)), "utf8");
const quoteDetail = readFileSync(fileURLToPath(new URL("./QuoteDetail.tsx", import.meta.url)), "utf8");
const strip = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

test("#1 every service line carries its own checkbox", () => {
  assert.match(publicEstimate, /type="checkbox"[\s\S]{0,200}aria-label=\{`Accept \$\{line\.description\}`\}/);
});

test("#1 the checkbox is written before the service, so it renders on the left", () => {
  const row = publicEstimate.slice(publicEstimate.indexOf("{lines.map((line)"), publicEstimate.indexOf("</label>"));
  assert.ok(row.indexOf('type="checkbox"') < row.indexOf("{line.description}"),
    "the box has to come before the description in the row");
});

test("#1 the chosen lines are highlighted", () => {
  assert.match(publicEstimate, /on \? "bg-emerald-50\/70 border-l-4 border-l-emerald-500"/);
});

test("#1 the choice is sent with the decision", () => {
  assert.match(publicEstimate, /acceptedLineItemIds: \[\.\.\.chosen\]/);
  assert.match(publicEstimate, /next === "accepted" \?/,
    "a decline sends no selection; it declines the lot");
});

test("#1 everything starts ticked, so the whole estimate is still one click", () => {
  assert.match(publicEstimate, /setChosen\(new Set\(\(data\.snapshot\?\.lineItems \?\? \[\]\)\.map\(\(line\) => line\.id\)\)\)/);
  assert.match(publicEstimate, /chosen\.size === lines\.length \? "Accept complete estimate"/);
});

test("#1 accepting nothing is refused in the page, not only by the server", () => {
  assert.match(publicEstimate, /disabled=\{submitting \|\| chosen\.size === 0\}/);
  assert.match(publicEstimate, /Tick at least one service to accept/);
});

test("#1 once decided, the boxes cannot be changed", () => {
  assert.match(publicEstimate, /disabled=\{Boolean\(decision\) \|\| submitting\}/);
});

test("#1 a service that was left is marked, not hidden", () => {
  assert.match(publicEstimate, /NOT ACCEPTED/);
});

test("#2 the module offers Kyle's six groupings", () => {
  for (const label of ["open", "pending", "accepted", "accepted_scheduled", "declined", "closed"]) {
    assert.ok(module_.includes(label), `${label} is missing from the module`);
  }
});

test("#2 the queue that needs action is rendered before the groupings", () => {
  assert.ok(module_.indexOf("needsSchedulingLabel") < module_.indexOf("data.groups.map"),
    "accepted estimates awaiting the office go at the top");
});

test("#2 the module says nothing has been booked", () => {
  assert.match(module_, /Nothing is booked until somebody schedules it/);
});

test("#2 the module is on the dashboard, above the financial reporting", () => {
  assert.match(dashboard, /<EstimateStatusModule \/>/);
  assert.ok(dashboard.indexOf("<EstimateStatusModule />") < dashboard.indexOf("financial-health"));
});

test("#2 a role without estimate access is shown nothing", () => {
  assert.match(module_, /hasClientCapability\(user, "quotes\.view"\)/);
  assert.match(module_, /if \(!canSee\) return null;/);
});

test("the dead convert path is gone from the estimate page", () => {
  const code = strip(quoteDetail);
  assert.doesNotMatch(code, /canConvert/);
  assert.doesNotMatch(code, /convertMutation/);
  assert.match(code, /<EstimateConversionDialog quoteId=/,
    "conversion now happens through the dialog, which schedules the work too");
});
