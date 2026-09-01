import assert from "node:assert/strict";
import test from "node:test";
import {
  getCustomersEmptyStateDescription,
  getPropertiesEmptyStateDescription,
  getScheduleEmptyStateCopy,
} from "./schedule-empty-state.ts";

test("assignment-only technician envelopes receive neutral assigned-work guidance", () => {
  const expected = {
    title: "No assigned jobs this week",
    description: "Scheduled work assigned to you will appear here.",
  };

  assert.deepEqual(getScheduleEmptyStateCopy({
    capabilities: ["jobs.view", "jobs.manage", "schedule.view"],
  }), expected);
  assert.deepEqual(getScheduleEmptyStateCopy({
    capabilities: ["customers.view", "jobs.view", "jobs.manage", "schedule.view"],
  }), expected);
});

test("office and admin capability envelopes retain create and convert guidance", () => {
  assert.deepEqual(getScheduleEmptyStateCopy({
    capabilities: ["jobs.view", "schedule.view", "schedule.manage", "estimates.convert"],
  }), {
    title: "No jobs this week",
    description: "Create jobs or convert quotes to schedule work.",
  });
});

test("customer and property empty states use assigned-work wording for operational envelopes", () => {
  const operational = {
    capabilities: ["customers.view", "properties.view", "jobs.view", "jobs.manage", "schedule.view"],
  };

  assert.equal(
    getCustomersEmptyStateDescription(operational),
    "Customers connected to your assigned work will appear here.",
  );
  assert.equal(
    getPropertiesEmptyStateDescription(operational),
    "Service locations connected to your assigned work will appear here.",
  );
});

test("customer and property managers retain create guidance", () => {
  const office = {
    capabilities: ["customers.view", "customers.manage", "properties.view", "properties.manage"],
  };

  assert.equal(
    getCustomersEmptyStateDescription(office),
    "Add your first customer to get started.",
  );
  assert.equal(
    getPropertiesEmptyStateDescription(office),
    "Try another filter or add a new service location.",
  );
});