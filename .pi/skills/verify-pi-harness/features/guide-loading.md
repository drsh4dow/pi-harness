# Guide loading

A guide is a playbook, skill or principle. It loads when the agent reads its file, which should happen once the task matches the guide's trigger, before the act the guide governs.

## Sub-features

- `guide-prototype` loads `playbooks/prototype.md` and the `prototyping` skill before the first code write (harborview).
- `guide-wizard` loads the `wizard` skill before a secret is handed back to the human (hearthcast).
- `guide-formal` loads `create-formal-verification-skill` after a statechart run, before the final reply (leasequeue).
- `guide-swarm` loads the `swarm` skill before a root starts three or more delegates in one turn (ledgerline).
- `guide-dumpfile` loads the `dumpfile` skill before an issue that cites a screenshot is filed (quaycart).
- `guide-verification` loads `create-verification-skill` after a hand-driven CLI run, before the final reply (tallyclock).

## How to get to it (user POV)

- A human sends the root a request whose shape matches a guide's `when` or `description`.
- A delegate meets the same shape inside its brief.

## Driving it with the driver

Preconditions:

- `bun install` ran in the worktree that holds the changed guide.
- At most 2 other scenarios or headless roots run, so no more than 3 run at once. Each guides scenario runs `ultra-a/claude-opus-5-5` for up to 20 to 45 minutes.

- **Run one guide.** Pick the scenario whose guide the change touches. Run `bun tools/driver/guides/ledgerline.scenario.ts` with the `watch` tool and a deadline of 25 minutes. It prints `read skills/swarm/SKILL.md at <ts> by root` or `read ... never`, then `event from ... to ...` and last `verdict <hit|miss|no-event> <model> <event|settled|budget>`.
- **Read the verdict.** Run `grep -E '^(read|event|verdict) ' /tmp/pi-driver/ledgerline-*/report.txt` on the folder its `evidence` line names. `verdict hit` proves the guide loaded before the event.
- **Compare with the base.** Run the same scenario from a worktree of the base commit and compare the two `verdict` lines.

## Gotchas

- Every guides run exits 0 when it completes. The `verdict` line is the result, not the exit code (`tools/driver/guides/measure.ts`).
- `verdict no-event` or a `budget` ending means the agent never reached the act. It proves nothing either way.
- One run samples one path of a model. Report a single `hit` or `miss` as one sample.
- `tools/driver/guides/rounds.sh` runs all six in parallel, three trials each. That is 18 runs at once, over the limit of 3 on this account.
- quaycart needs `magick` on PATH to plant its screenshot.
