---
name: Authorization route-test credibility
description: How to make route-level access-control tests prove the behavior of production handlers.
---

Authorization and data-redaction HTTP tests must mount the same exported router factories used by production, with narrow injected repository ports for isolated fixtures. Never duplicate route behavior in test-only routers.

**Why:** A separate in-memory router can pass while the real handlers still leak records, omit redaction, or write before denial. It proves the fixture implementation rather than the production boundary.

**How to apply:** When real routes capture a concrete database import, introduce a narrow dependency seam only around the behavior under test. Keep default exports wired to the real database adapter, and mount those exact factories with in-memory adapters in port-0 Express tests.