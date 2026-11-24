---
when: After completing a task or a step, before you declare it done or report that it works.
---

# Prove It Works

Verify every output by checking the real thing directly: run the feature, read the actual value, inspect the diff. Proxies (file mtimes, self-reports, cached output, "it compiles") do not count. When a check fails, suspect the observation method before the system.

Done also means the Definition of Done, the project-wide bar for every change: tests pass, no regressions, behavior verified at runtime, docs updated. Its checklist is `~/.pi/agent/references/definition-of-done.md`. It adds to each task's acceptance criteria rather than replacing them.

Script the check when you can. A deterministic script that reruns the comparison beats a one-time look. Keep its output where the human can see it, and commit it only when the trail must be auditable later.
