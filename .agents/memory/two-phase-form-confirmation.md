---
name: Two-phase form confirmation
description: Reliable confirmation and retry behavior for forms that create a parent record and then commit a related secondary record.
---

For a create-then-secondary-write form, success requires both the immediate mutation response and an independent readback to match every requested canonical value. If the secondary write or verification fails after the parent exists, retain the parent identity and the user's secondary draft; retries must target the existing parent rather than create another one. When the parent and secondary record can be created as one aggregate, use one atomic transaction plus persisted request idempotency; an ambiguous response retry must replay that aggregate.

**Why:** A successful HTTP response alone can hide stale or incomplete persisted state, while leaving a create form reusable after the parent commits can turn a recovery click into a duplicate business record. A client-only pending flag cannot prevent duplicates after a lost response or reload.

**How to apply:** Keep server-side validation authoritative and fail closed on either comparison. If creation is split, retry only the secondary mutation. If atomic, keep the same idempotency key across ambiguous failures and route an unconfirmed result to the committed resource rather than offering another create.

For controlled forms that use live `FormData` as submission authority, copy that exact submitted snapshot back into controlled state before showing validation errors or starting the request.

**Why:** A toast or mutation-state update can rerender immediately; if React state is older than the visible DOM, the rerender erases the user's live values even though validation correctly read them.

**How to apply:** Retain every retryable live field from the same `FormData` snapshot used for validation. Do this before every client-error return and before mutation dispatch so server failures preserve the same draft too.