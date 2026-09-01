---
name: Monorepo verification gates
description: Gotchas when running typecheck/build gates in the CRM pnpm monorepo (stale composite builds, vite env requirements)
---
# Monorepo verification gates

- Lib packages (db, api-zod, api-client-react, replit-auth-web) are TS composite projects emitting declarations to `dist/` with a `tsconfig.tsbuildinfo`. Artifact typechecks (`tsc -p`) resolve workspace types from those BUILT declarations, not from source.
- **Why:** after regenerating orval clients or editing lib/db schema, artifact typechecks kept reporting the OLD types ("no exported member", missing new columns) even though the sources were correct — the declarations were stale.
- **How to apply:** after codegen or any lib source edit, run `pnpm exec tsc -b lib/db lib/api-zod lib/api-client-react lib/replit-auth-web --force` before trusting `pnpm --filter <pkg> run typecheck`.
- CRM `vite build` loads `vite.config.ts`, which throws unless `PORT` and `BASE_PATH` env vars are set (the workflow provides them in dev). Manual build gate: `PORT=22444 BASE_PATH=/ pnpm --filter @workspace/crm run build`.
- The OpenAPI spec is the source of truth for generated clients. A hand-drifted generated file (AuthUser had `role` while the spec lacked it) got silently reverted by regen and broke typechecks — keep the spec complete; never patch generated output.

## Generated client contract tests under Node

The built-in Node TypeScript test runner cannot directly import the generated API client because its ESM graph uses extensionless relative imports that the application bundler resolves but Node does not.

**Why:** importing the package entry from a Node test fails before execution with `ERR_MODULE_NOT_FOUND`, even though Vite and production builds resolve the same graph correctly.

**How to apply:** for lightweight Node contract tests, assert the generated serializer shape from generated source and exercise equivalent browser `Request` JSON semantics. Use browser/bundler integration tests when direct generated-client execution is essential; do not add root-only DOM dependencies that violate workspace boundaries.
