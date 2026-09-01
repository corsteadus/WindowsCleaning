import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveViteBasePath,
  resolveVitePort,
} from "./vite-config-env.ts";

describe("CRM Vite build/runtime environment resolution", () => {
  it("does not require workflow runtime variables for a production build", () => {
    assert.equal(resolveVitePort(undefined, "build"), 5173);
    assert.equal(resolveViteBasePath(undefined, "build"), "/");
  });

  it("preserves injected PORT and BASE_PATH values", () => {
    assert.equal(resolveVitePort("22444", "serve"), 22444);
    assert.equal(resolveViteBasePath("/crm", "serve"), "/crm");
  });

  it("still fails clearly when a runtime server is missing its injected values", () => {
    assert.throws(
      () => resolveVitePort(undefined, "serve"),
      /PORT environment variable is required/,
    );
    assert.throws(
      () => resolveViteBasePath(undefined, "serve"),
      /BASE_PATH environment variable is required/,
    );
  });

  it("rejects invalid injected ports", () => {
    assert.throws(() => resolveVitePort("0", "serve"), /Invalid PORT/);
    assert.throws(() => resolveVitePort("not-a-port", "serve"), /Invalid PORT/);
  });
});