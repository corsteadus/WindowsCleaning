---
name: Data Free startup boundary
description: Why startup mutation workers are explicit opt-ins in the Sandbox.
---

Legacy repair/import-resume work and state-changing background workers must remain disabled by default in a declared Data Free Sandbox and require an explicit matching Sandbox identity. Non-Sandbox environments retain normal worker startup.

**Why:** A Data Free guarantee cannot depend on startup jobs merely finding no rows; normal startup must itself be non-mutating.

**How to apply:** Keep mutation-worker flags unset during ordinary Data Free Sandbox development, smoke checks, and handoff. Treat enabling either class as an explicitly authorized Sandbox operation; do not disable production processing.