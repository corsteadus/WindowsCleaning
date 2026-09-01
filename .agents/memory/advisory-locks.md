---
name: Advisory lock namespaces & convert-core pattern
description: How conversion endpoints serialise with pg advisory locks and the adapter pattern they share
---
Rule: quote/job conversion locks use the single-int form `pg_advisory_xact_lock(quoteId)`; lead conversion uses the two-int form `pg_advisory_xact_lock(2, leadId)`. PostgreSQL keeps the (int4,int4) and (int8) keyspaces fully separate, so the namespaces cannot collide by construction. Any new endpoint serialising on one of these entities must reuse the same key helper.

**Why:** an earlier additive-offset scheme (lead key = 1e9 + id) only assumed no collision; code review flagged it. The two-int form makes collision impossible.

**How to apply:** any operation that reads a quote state and then mutates quote terms or lifecycle state must acquire the shared quote lock and re-read state inside the same transaction. This includes customer and staff paths so neither side can win a check-then-act race. Keep conversion logic behind the established adapter pattern and fail atomically when the parent state changes.
