import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  AUTH_INVALID_EVENT, AUTH_REVALIDATE_EVENT, authScopeFingerprint, authScopedQueryKey, mandatoryAuthScopeQueryHash,
  setActiveAuthScopeFingerprint,
} from "./auth-scope.ts";
import { ApiError, customFetch } from "../../../../lib/api-client-react/src/custom-fetch.ts";

const base = {
  tenantId: "tenant-a",
  userId: "tech-a",
  normalizedRole: "field",
  permissionVersion: "permissions-1",
  assignmentScopeVersion: "assignments-1",
  capabilities: ["jobs.view"],
};

test("protected query keys partition every authorization dimension", () => {
  const key = (overrides = {}) => authScopedQueryKey({ ...base, ...overrides }, ["/api/jobs", { page: 1 }]);
  for (const overrides of [
    { tenantId: "tenant-b" },
    { userId: "tech-b" },
    { permissionVersion: "permissions-2" },
    { assignmentScopeVersion: "assignments-2" },
    { normalizedRole: "office" },
    { capabilities: ["jobs.view", "jobs.manage"] },
  ]) {
    assert.notDeepEqual(key(), key(overrides));
  }
});

test("capability ordering does not create a false scope transition", () => {
  assert.equal(
    authScopeFingerprint({ ...base, capabilities: ["jobs.manage", "jobs.view"] }),
    authScopeFingerprint({ ...base, capabilities: ["jobs.view", "jobs.manage"] }),
  );
});

test("mandatory QueryClient hashing partitions even a generic unscoped key", () => {
  const genericKey = ["bespoke", "activity", { page: 1 }];
  const hash = (overrides = {}) => {
    setActiveAuthScopeFingerprint(authScopeFingerprint({ ...base, ...overrides }));
    return mandatoryAuthScopeQueryHash(genericKey);
  };
  for (const overrides of [
    { normalizedRole: "office" }, // Admin → Tech/role transition
    { userId: "tech-b" }, // Tech A → Tech B
    { tenantId: "tenant-b" },
    { permissionVersion: "permissions-2" },
    { assignmentScopeVersion: "assignments-2" },
  ]) assert.notEqual(hash(), hash(overrides));
  setActiveAuthScopeFingerprint(null);
});

test("unknown authorization envelopes fail closed", () => {
  assert.equal(authScopeFingerprint(null), null);
  assert.equal(authScopeFingerprint({ ...base, tenantId: "" }), null);
  assert.deepEqual(authScopedQueryKey(null, ["customers"]), ["auth-scope", "invalid", "customers"]);
});

test("scope transitions clear caches before rendering and revalidate bfcache restores", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../../../../lib/replit-auth-web/src/use-auth.ts", import.meta.url), "utf8");
  assert.match(app, /useLayoutEffect\(\(\) => \{\s*\/\/[\s\S]*?queryClient\.clear\(\);\s*setReadySignature/);
  assert.match(app, /readySignature !== signature/);
  assert.match(app, /<AuthGate key=\{signature\}/);
  assert.match(auth, /event\.persisted/);
  assert.match(auth, /visibilitychange/);
  assert.match(auth, /addEventListener\("online"/);
  assert.match(auth, /addEventListener\("focus"/);
});

test("401 invalidates while 403 only requests envelope revalidation", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as typeof globalThis & { window?: EventTarget }).window;
  const events: string[] = [];
  const windowTarget = new EventTarget();
  windowTarget.addEventListener(AUTH_INVALID_EVENT, () => events.push(AUTH_INVALID_EVENT));
  windowTarget.addEventListener(AUTH_REVALIDATE_EVENT, () => events.push(AUTH_REVALIDATE_EVENT));
  (globalThis as typeof globalThis & { window?: EventTarget }).window = windowTarget;
  try {
    for (const [status, expected] of [[401, AUTH_INVALID_EVENT], [403, AUTH_REVALIDATE_EVENT]] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: "Denied" }), {
        status, headers: { "content-type": "application/json" },
      });
      await assert.rejects(customFetch("/api/protected"), ApiError);
      assert.deepEqual(events.splice(0), [expected]);
    }
  } finally {
    globalThis.fetch = previousFetch;
    (globalThis as typeof globalThis & { window?: EventTarget }).window = previousWindow;
  }
});

test("generated requests disable browser caching and distinguish denied responses", () => {
  const source = readFileSync(new URL("../../../../lib/api-client-react/src/custom-fetch.ts", import.meta.url), "utf8");
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /response\.status === 403/);
  assert.match(source, /crm:protected-auth-invalid/);
  assert.match(source, /crm:protected-auth-revalidate/);
});

test("JobDetail keeps its protected layout for 404 and ordinary 403 query errors", () => {
  const job = readFileSync(new URL("../pages/JobDetail.tsx", import.meta.url), "utf8");
  assert.match(job, /if \(isError \|\| !job\) \{\s*return \(\s*<Layout>/);
  assert.match(job, /Job not found/);
  assert.match(job, /enabled: canViewInvoices/);
  assert.doesNotMatch(job, /signalInvalidAuthorization/);
});

test("authenticated API callers use protectedFetch; only documented public/presigned fetches remain", () => {
  const root = new URL("../", import.meta.url);
  const protectedSources = [
    "pages/Schedule.tsx", "pages/LeadDetail.tsx", "pages/Communications.tsx",
    "components/FilesTab.tsx", "components/CommunicationSafetyCard.tsx",
    "components/EstimateConversionDialog.tsx",
  ];
  for (const relative of protectedSources) {
    const source = readFileSync(new URL(relative, root), "utf8");
    assert.match(source, /protectedFetch/);
    assert.doesNotMatch(source, /\bfetch\(\s*[`'"][^`'"]*\/api/);
  }
  const files = readFileSync(new URL("components/FilesTab.tsx", root), "utf8");
  assert.match(files, /Public presigned GCS URL/);
  const publicEstimate = readFileSync(new URL("pages/PublicEstimate.tsx", root), "utf8");
  assert.match(publicEstimate, /Public estimate links intentionally work without an authenticated session/);
});

test("raw-fetch audit leaves no authenticated /api bypass", () => {
  const srcRoot = new URL("../", import.meta.url);
  const rootPath = srcRoot.pathname;
  const files = readdirSync(rootPath, { recursive: true }) as string[];
  const bypasses = files
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
    .map((file) => [relative(rootPath, join(rootPath, file)), readFileSync(join(rootPath, file), "utf8")] as const)
    .filter(([, source]) => /\bfetch\(\s*[`'"][^`'"]*\/api/.test(source))
    .map(([file]) => file);
  assert.deepEqual(bypasses, ["pages/PublicEstimate.tsx"]);
});