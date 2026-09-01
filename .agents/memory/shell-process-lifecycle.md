---
name: Shell process lifecycle & persistence
description: Why background processes die when a shell tool call ends, and how to run something that must persist (workflows), plus pgrep/pkill self-match footgun.
---

# Background processes cannot outlive a shell tool call

**Rule:** Any process spawned inside a shell tool call is killed when that call returns. `nohup`, `&`, `disown`, and even `setsid` (own session id confirmed) do NOT save it — cleanup appears to be cgroup/scope-wide, not a process-group SIGHUP.

**Why:** Observed 2026-08: a `setsid`-detached watchdog + python http.server both verified alive and serving (200) inside the call, dead before the next call; external clients got 502 with empty bodies (sha256 `e3b0c44…` = empty string is the tell for hashing a failed download).

**How to apply:** Anything that must outlive a call — temp file servers, watchers, demo processes — must run as a workflow:
- Non-artifact process: `configureWorkflow({ name, command, outputType: "console", autoStart: true })` via CodeExecution. `waitForPort` only accepts a fixed port whitelist; omit it when binding a port outside that list that the proxy already routes.
- Artifact services: use the managed `artifacts/<slug>: <name>` workflows via WorkflowsRestart.

**Caveat:** `configureWorkflow` writes the workflow entry into tracked `.replit`. If the tracked tree must stay clean, disclose the uncommitted mod and `removeWorkflow` + verify `git status` when done.

**Useful corollary:** proxy routing previewPath→localPort from artifact.toml keeps forwarding while that artifact's workflow is STOPPED — a stopped artifact's port/path can be borrowed for a temporary server (e.g. serve /tmp files at its previewPath).

# pgrep/pkill -f self-match footgun

`pkill -f "<pattern>"` matches the *calling script's own cmdline* when the pattern string appears in it — it killed the running ShellExec script mid-command (exit -1, output truncated at that line). Same for `pgrep -f` (false-positive "alive" pid = the shell itself).

**How to apply:** in one-shot tool scripts, avoid pkill/pgrep -f with literal patterns; use pidfiles, `pgrep -x`, or bracket the pattern (`"http[.]server 8081"` style) so the self cmdline no longer contains the raw string.

Refinement (2026-08, handoff cleanup incident): even a BRACKETED `pgrep -f "http[.]server"` pattern is not enough if any *other* string in the same script — an echo message, a comment — contains the plain form ("http.server"); the pid list then includes your own bash, and `kill` terminates the script mid-run (observed: exit -1 right after the first kill, remaining commands never ran). Guard: before killing, verify `/proc/<pid>/cmdline` starts with the target binary (e.g. `^python3 `); never kill pids whose cmdline you have not inspected.
