---
name: Live smoke-test constraints
description: Owner rule about testing against the running sandbox
---
Rule: live smoke tests against the running sandbox API must be non-mutating — validation/not-found paths only (e.g. 404 for missing id, 400 for bad id). Never convert, edit, create, or delete records, even throwaway ones.

**Why:** owner instruction (Aug 2026) after a smoke test created/deleted a temporary lead+customer.

**How to apply:** cover all successful/mutating behavior with the executable unit tests (`pnpm test` in artifacts/api-server); limit curl checks to error-path status codes.
