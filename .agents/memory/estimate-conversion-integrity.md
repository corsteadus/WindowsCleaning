---
name: Estimate conversion integrity
description: Durable acceptance and transaction rules for converting accepted estimates into scheduled work.
---

Estimate conversion must trust acceptance provenance tied to the exact finalized revision, not a mutable display status. A documented, authorized verbal acceptance is the explicit alternative; legacy approved records are the compatibility exception.

**Why:** A status-only gate can mislabel an unaudited staff status change as customer acceptance, while stale location ownership can create jobs against the wrong account.

**How to apply:** Under the shared estimate lock, re-read the accepted revision, revalidate every physical location against the canonical active account, then promote and create every location job in one transaction. Any failure rolls back the whole operation.