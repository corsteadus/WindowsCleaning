---
name: Cloned Sandbox migration attestation
description: How to handle a stale Sandbox Repl identity guard after a restore or clone.
---

The persisted Sandbox migration identity can point to a predecessor Repl after the workspace is restored or cloned. Treat an identity mismatch as a hard stop by default; do not infer that the current database is safe merely from an environment label.

**Why:** Identity mismatches can indicate a stale clone guard or the wrong target; bypassing either without explicit target authorization risks running a migration against an unintended database.

**How to apply:** Prefer correcting the persistent identity configuration through the approved environment workflow. A command-scoped current-Repl identity override is acceptable only when the user explicitly authorizes that exact current Sandbox target; never use it for production or as a generic way around a gate.