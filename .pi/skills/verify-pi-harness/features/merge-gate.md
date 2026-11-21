# Merge gate

The `gh` wrapper in `agent/bin/gh` refuses a merge unless the verdict ledger holds a pass at the PR's current head, or a pass whose patch-id matches. It prints `merge gate: merge refused.` and exits 1. Every other `gh` call reaches the real `gh` unchanged.

## Sub-features

- `gate-refuse` refuses `gh pr merge <n>` with no pass at the head and names the fix.
- `gate-pass` runs the real `gh pr merge` with `--match-head-commit <head>` once a pass exists.
- `gate-auto` refuses `gh pr merge --auto` and the `gh api` merge and auto-merge calls.
- `gate-through` passes every call that is not a merge, `gh issue list` included.

## How to get to it (user POV)

- An agent runs `gh pr merge <n>`, `gh stack merge <n>` or a `gh api` call that merges, with the harness `agent/bin` first on PATH.
- A verifier delegate's pass lands in `~/.local/state/pi-agent/verdicts/<repo>/<n>/<head>.<session>.json` when the root wakes on it.

## Driving it with the driver

Preconditions:

- `bun install` ran in the worktree.
- `gh auth status` shows a login that can push to `drsh4dow/pi-gate-scratch`, for the scenario.

- **Offline drive.** Run `bun test agent/bin/gh.test.ts`. It runs the real wrapper with a fake `gh` second on PATH and a scratch HOME. It passes when the refusal, the pinned pass with `--match-head-commit`, and a call that only names a merge all hold. It covers `gate-refuse`, `gate-pass` and `gate-through`.
- **Real drive.** Run `bun src/features/pr/merge-gate.scenario.ts` with the `watch` tool and a 30 minute deadline. It opens PRs on `drsh4dow/pi-gate-scratch`, has six verifiers record passes, and merges through the wrapper. It prints `pass merge-gate` and an `evidence` folder, whose `report.txt` holds every check.

## Gotchas

- `~/.pi/agent/bin` is first on this machine's PATH. A second harness `agent/bin` before or after it makes the two wrappers call each other forever, and `gh --version` hangs.
- A broken fake `gh` also exits 1. Assert the `No verdict is recorded` line, not only the exit code.
- With `GH_HOST=github.invalid` the gate refuses with "could not read what it lands". That proves the wrapper ran, not the verdict logic.
- A verdict file that does not decode is skipped without a message, so it reads as a refusal.
- Your real HOME holds real verdicts. Drive with a scratch HOME.
