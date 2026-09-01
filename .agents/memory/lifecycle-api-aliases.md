---
name: Lifecycle API aliases
description: Security and audit rules for API aliases that expose one lifecycle subset of a shared account model.
---

An API alias for a lifecycle subset must have explicit server-side capability rules and constrain every detail mutation to records currently in that lifecycle. Lifecycle conversion belongs on a narrowly authorized transition endpoint, not a general patch. Audit actors must come from the authenticated request, never client input.

**Why:** A frontend route guard does not protect direct API calls, and an ID-only alias can otherwise expose or mutate records from a different lifecycle. Client-supplied actor fields also allow forged conversion history.

**How to apply:** Whenever adding a new alias over a shared entity, review ordered authorization matching, list and detail filters, patch/delete predicates, transition permissions, date preservation, and audit-event identity together.