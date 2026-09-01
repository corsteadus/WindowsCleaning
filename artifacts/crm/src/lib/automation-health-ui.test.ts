import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { AUTOMATION_ROUTES, matchAutomationRoute } from "./automation-routes.ts";

const page = fs.readFileSync(new URL("../pages/AutomationHealth.tsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../components/Layout.tsx", import.meta.url), "utf8");

test("automation health is routed and capability gated", () => {
  const healthRoute = app.indexOf("path={AUTOMATION_ROUTES.health}");
  const dynamicRoute = app.indexOf("path={AUTOMATION_ROUTES.detail}");
  assert.ok(healthRoute >= 0, "explicit health route is registered");
  assert.ok(dynamicRoute >= 0, "dynamic automation detail route is registered");
  assert.ok(healthRoute < dynamicRoute, "health route precedes the dynamic :id route");
  assert.match(app, /component={AutomationHealth}/);
  assert.match(layout, /automation_events\.view/);
  assert.match(page, /useGetFinancialCapabilities/);
  assert.match(page, /automation_events\.view/);
});

test("reserved health path never resolves as an automation ID", () => {
  assert.deepEqual(matchAutomationRoute(AUTOMATION_ROUTES.health), {
    kind: "health",
    path: AUTOMATION_ROUTES.health,
  });
  assert.deepEqual(matchAutomationRoute(`${AUTOMATION_ROUTES.health}?status=retrying`), {
    kind: "health",
    path: AUTOMATION_ROUTES.health,
  });
  assert.notDeepEqual(matchAutomationRoute(AUTOMATION_ROUTES.health), {
    kind: "detail",
    path: AUTOMATION_ROUTES.health,
    id: "health",
  });
  assert.match(page, />Automation health</);
});

test("normal automation IDs remain dynamic and unauthorized health access is denied", () => {
  assert.deepEqual(matchAutomationRoute("/automations/42"), {
    kind: "detail",
    path: "/automations/42",
    id: "42",
  });
  assert.equal(matchAutomationRoute("/automations/health/extra"), null);
  assert.ok(layout.includes("href: AUTOMATION_ROUTES.health"));
  assert.ok(layout.includes('requiredCapability: "automation_events.view"'));
  assert.match(page, /const canView = capabilities\?\.includes\("automation_events\.view"\)/);
  assert.match(page, /if \(!canView\)/);
  assert.match(page, /Automation health is restricted/);
});

test("automation health uses real event history hooks and safe retry semantics", () => {
  assert.match(page, /useListAutomationEvents/);
  assert.match(page, /useGetAutomationEvent/);
  assert.match(page, /useListAutomationEventDeliveryAttempts/);
  assert.match(page, /useGetAutomationEventAttempt/);
  assert.match(page, /useRetryAutomationEvent/);
  assert.match(page, /createIdempotencyKey/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /deliveryId/);
  assert.doesNotMatch(page, /retryAll|retry-all/i);
});