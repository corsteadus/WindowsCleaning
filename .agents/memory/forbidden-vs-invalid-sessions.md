---
name: Forbidden responses versus invalid sessions
description: Why ordinary resource authorization failures must not tear down the authenticated application.
---

Treat an authenticated resource or capability `403` as a request to revalidate the current authorization envelope, not as proof that the session is invalid. Keep immediate protected-tree invalidation for `401`. If revalidation changes tenant, user, permissions, or assignment scope, the authorization fingerprint transition must purge caches and remount before protected content renders.

**Why:** An assigned-work user can legitimately receive `403` from an inaccessible resource or an auxiliary endpoint. Treating every `403` as session loss blanked the entire application instead of allowing local not-found/access states to render.

**How to apply:** Shared authenticated fetchers should distinguish `401` from `403`. Resource components must render non-enumerating local error states, while the auth-scope transition remains authoritative for clearing stale privileged data after role or assignment changes.