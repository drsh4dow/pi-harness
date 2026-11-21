# Prompt capture

`bun run prompts [project-dir]` writes `system-prompts.md` at the worktree root. It holds the first request pi builds for stock pi, the root, and each kind of owner and leaf, for a session started in the project folder. No request reaches a model.

## Sub-features

- `prompts-kinds` shows the full prompt of stock pi, the root, and every owner and leaf kind.
- `prompts-skills` lists the skills each kind may load, one `<available_skills dir="...">` block per folder, project `.pi/skills` included.
- `prompts-project` builds each prompt as a session started in the given project folder would get it.

## How to get to it (user POV)

- Run `bun run prompts` after you change `SYSTEM.md`, a role, a principle, a playbook, a skill's description or a file in `agent/instructions/`.
- Pass a project folder to see what a session started there gets.

## Driving it with bun run prompts

Preconditions:

- `bun install` ran in the worktree that holds the change.

- **Capture this repo.** Run `bun run prompts`. It logs `wrote <worktree>/system-prompts.md` and exits 0.
- **Find a skill.** Run `grep -n '^- verify-pi-harness' system-prompts.md`. Each kind that may load the skill shows its line, under `<available_skills dir="<worktree>/.pi/skills">`.
- **Capture another project.** Run `mkdir -p /tmp/prompts-other && git -C /tmp/prompts-other init -q && bun run prompts /tmp/prompts-other`, then the same `grep`. It finds nothing, since a project skill loads only in its own project.
- **Diff two commits.** Run it in a worktree of the base and of the change, then `diff` the two `system-prompts.md` files.

## Gotchas

- Each run overwrites `system-prompts.md`. Copy it before the next capture.
- It shows what an agent is given, not what it does. A behavior claim needs a scenario or a headless root.
- It links the entries of your `~/.pi/agent` that the worktree's `agent/` lacks, such as `auth.json`, into that folder for the run and removes them after.
- `.pi/skills` loads only in a trusted project. Your `settings.json` sets `defaultProjectTrust`.
