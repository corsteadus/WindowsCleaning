---
name: Composite customer operations integrity
description: Safety rules for atomic account onboarding and cross-domain customer profile aggregation.
---

Any operation that creates both an account and scheduled work must require both customer-management and scheduling authority, and must persist every account, relationship, snapshot, activity, outbox, and idempotency result in one transaction.

**Why:** Prefix-only authorization can accidentally grant a lower-privilege customer role the ability to schedule work. Customer profile aggregation can likewise bypass payment or communication permissions if related records are returned unconditionally.

**How to apply:** Put exact composite route rules before generic prefixes, bind idempotent replay metadata to every returned resource rather than selecting an arbitrary related row, and gate each cross-domain profile collection by its own capability.