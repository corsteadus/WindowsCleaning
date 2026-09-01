---
name: Additive migration preflight safety
description: Runtime constraints for application migrations that inspect schema before adding it.
---

An additive migration's preflight must detect whether a newly introduced column or table exists before querying it. Treat an absent new object as having zero rows or references, then verify the real object after DDL.

**Why:** A fresh Sandbox run failed before DDL when preflight joined through the not-yet-created direct-assignment column. The same run exposed that `Promise.all` on one checked-out `pg` client is deprecated and will become an error in pg 9.

**How to apply:** Keep queries against a migration context's single client sequential. Gate queries involving new objects with catalog existence checks, and use postflight catalog verification for the fully created schema.