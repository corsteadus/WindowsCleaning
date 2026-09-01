---
name: Auth session envelope & local login
description: How CRM auth endpoints behave when logged out; provisioning local username/password logins across environments
---
# Auth envelope & local login

- `GET /api/auth/user` returns **200 with `{"user":null}`** when unauthenticated — never 401. Logout/session tests must assert the response BODY, not just the status code.
- **Why:** a logout verification falsely "failed" (200 after logout) and triggered a debug loop; the session was actually destroyed and the endpoint was returning the null envelope by design.
- Local (username/password) login coexists with Replit OIDC: sessions carry `auth_method: "local" | "oidc"`; sessions with no OIDC `expires_at` skip token refresh; logout branches on `auth_method` (local skips the OIDC end-session redirect).
- scrypt hash strings (`scrypt:N:r:p:saltHex:keyHex`) are environment-independent — the same hash value works in any environment's users table. Production provisioning = run the api-server hash-password script, then additive SQL (username/password_hash columns + the user row) through the owner's manual handoff process; the agent never touches prod.
- `@workspace/db` cannot be imported by scripts run under plain `node --experimental-strip-types` (directory imports unsupported outside bundlers) — standalone scripts must stick to node built-ins and local src imports.
