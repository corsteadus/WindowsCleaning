---
name: Temp file-handoff serving mechanics
description: Gotchas when serving /tmp files publicly via a temporary workflow on the borrowed /__mockup→8081 route
---

Rules for the temporary tokenized file-serving pattern (python http.server on the mockup-sandbox port while that workflow is stopped):

- The shared proxy forwards the FULL request path unstripped: `/__mockup/<token>/f` arrives as `/__mockup/<token>/f`, so the served tree must mirror the `__mockup/` prefix under the server's cwd.
- The platform port-watcher cannot see `127.0.0.1` binds. Configure the console workflow WITHOUT waitForPort, or the start times out and kills the server despite it running.
- `removeWorkflow`/failed starts can orphan the server process; it then answers proxy traffic with 404s from a deleted cwd and blocks the artifact's vite from rebinding. Always `kill <exact pid>` afterward, verify with a bracketed pattern (`pgrep -af "http[.]server PORT"`), then restart the artifact workflow AFTER the port is truly free.
- Dev `*.replit.dev` domains rotate on container migration/hibernation → external fetchers see host-wide 404 on the old hostname. Re-read `$REPLIT_DEV_DOMAIN` and re-issue URLs; have the other side fetch promptly.
- Put an `index.html` stub at every directory level of the served tree (root and `__mockup/`) so http.server's directory listing cannot leak the token.
- `configureWorkflow` writes a block into tracked `.replit`; auto-checkpoints commit it. Cleanup = removeWorkflow, then restore `.replit` from the pre-handoff commit and commit the restoration (verify by sha256 vs `git show <commit>:.replit`).

**Why:** each of these caused a real failure during a Sandbox→production handoff (404s from path mismatch, port-watch kill, orphan blocking vite with proxy 502 after cleanup, host-wide 404 for the fetching side after domain rotation).

Refinement (2026-08, teardown #4): `fuser 8081/tcp` returned a FALSE NEGATIVE for a live listener (reported "no listener" while SimpleHTTP kept answering) — do not trust fuser/pgrep for the port-free check. Authoritative check: `grep ':1F91 ' /proc/net/tcp*` (hex port, state 0A = LISTEN) plus a `curl localhost:<port>` probe; find the owner by sweeping `/proc/[0-9]*/cmdline` for the exact `python3 -m http.server <port>` prefix and verifying `/proc/<pid>/cwd` points at the handoff dir (shows "(deleted)" suffix after purge). WorkflowsRestart will report success even when vite dodges a squatted port — always re-verify the Server header on the real port after restart.
