# pi-harness verification map

This folder is the maintained source for proving what the harness does at runtime. Read the index, then use the matching feature file as the recipe. [`../SKILL.md`](../SKILL.md) holds Launch, Doctor, Evidence and Cleanup.

## Baseline preconditions

- Work in a git worktree of `drsh4dow/pi-harness` with `bun install` run, never in the live `~/.pi`.
- For a headless root, `$repo`, `$skill` and `$run` are set and the pinned checkout exists, as `SKILL.md` Launch shows, and `doctor.sh` exits 0.
- For a scenario, the change sits in the worktree you run `bun <file>.scenario.ts` from. The driver runs that worktree's `agent/`, uncommitted edits included.
- No other headless root or scenario runs on this account.

## Driving conventions

- Start every recipe from a fresh `$run` or a fresh driver run. Never reuse a run folder.
- Treat every command as literal. Keep quoted prompts unchanged, since the prompt is what the run measures.
- Read session entries with `jq` for every claim. The root's reply is a claim, not proof.
- List the scenarios that exist with `find src tools -name '*.scenario.ts'`. A scenario lives beside the code it proves.

## Proof and skip reporting

- Name the feature ID, the path (scenario or headless root), the pinned commit and the run folder with every artifact.
- Quote the session entries that show the action and its result, such as a `delegate-started` and its `job-settled`.
- For a scenario, quote its `pass` or `fail` line and, for a guide, its `verdict` line.
- A run that ended on its deadline, on a question in `reply.txt`, or with driver exit 2 proves nothing. Report it with the reason and run again or skip.
- Report a skipped entry point as skipped. A proof through one entry point does not cover another.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the behavior an agent or the human sees. It then has exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and pairs each action with an exact command and the observable result.
4. `Gotchas` lists traps that waste or invalidate a run.

## Features

- [Delegate start and wake](./delegate-wake.md) covers a root starting a leaf, waiting in print mode and waking with its answer.
- [Guide loading](./guide-loading.md) covers a playbook, skill or principle loading on its trigger, measured by the guides scenarios.
- [Merge gate](./merge-gate.md) covers the `gh` wrapper refusing a merge without a pass at the PR's head.
- [Prompt capture](./prompts.md) covers `bun run prompts`, the text each kind of agent gets, with no model call.
