---
name: verify-pi-harness
description: "Proving a change to this harness at runtime, such as a prompt, a guide, a tool or an extension. Runs a driver scenario or a headless root on the commit under test and keeps its session files as evidence."
---

# Verify pi-harness

This repo is pi's config folder. Its users are agents, the root a human talks to and the owners and leaves it starts. A change is proven when a real `pi` on the changed `agent/` folder does the thing and its session files show it. Read [`features/README.md`](features/README.md), then the feature file each change touches.

Pick the path by the fact you need:

- **One mechanism**, such as a guide loading on its trigger, a refusal, a wake or a compaction, gets a `*.scenario.ts` run by the driver. It checks itself and exits 0 or 1. [`tools/driver/README.md`](../../../tools/driver/README.md) is its reference.
- **A whole run under a prompt**, such as which delegates a root starts, whether it finishes without asking, or what it writes, gets a headless root.
- **The text an agent gets**, with no model call, gets `bun run prompts [project-dir]`. See [`features/prompts.md`](features/prompts.md).

A scenario and a headless root spend real model calls on the one account every agent on this machine shares. Run them once, at the code-ready head: between edit rounds, iterate on `bun run prompts` and unit tests. Run at most 3 at once. A mechanism check takes 1 trial, and a claim about agent behavior takes at least 3.

## Launch

A scenario runs the worktree as it is, uncommitted edits included. A headless root runs a pinned commit, so commit first. Neither runs on the live `~/.pi`.

**Scenario.** From the worktree under test:

```sh
bun install
bun src/features/owned-work/brief.scenario.ts
```

Run the scenario the feature file names. This one proves each delegate gets its brief by role. The driver builds a scratch world on this worktree's `agent/` and tears it down. It is up once it prints `agent <path>`.

**Headless root.** Pin the commit under test, so an edit mid-run cannot change the prompts the run reads:

```sh
repo=$(git rev-parse --show-toplevel)
skill=$repo/.pi/skills/verify-pi-harness
run=/tmp/verify-pi-harness/$(date +%Y%m%d-%H%M%S)
mkdir -p "$run/project"
git -C "$repo" worktree add --detach "$run/checkout" HEAD
(cd "$run/checkout" && bun install)
"$skill/scripts/make-agent-dir.sh" "$run/checkout" "$run/agent"
git -C "$run/project" init -q -b main
echo "# scratch" >"$run/project/README.md"
git -C "$run/project" add README.md && git -C "$run/project" commit -qm "chore: start"
systemctl --user list-units --plain --no-legend 'pi-ow-*' >"$run/units.before"
```

Write the prompt to `$run/prompt.txt`. Run Doctor, then start the root with the `watch` tool and a deadline 90 seconds above the script's own:

```sh
"$skill/scripts/headless-root.sh" "$run/agent" "$run/project" "$run/prompt.txt" "$run" 900
```

It prints `exit <code> after <s> s` once the root ends. `0` is a finished run, `124` is the deadline, `2` is a terminal core that never came up. A sixth argument `provider/id` replaces the default model from your `settings.json`. A cheaper root changes the behavior you measure, so use one only for a mechanism check.

## Doctor

```sh
"$skill/scripts/doctor.sh" "$run/checkout" "$run/agent"
```

Every line reads `ok` and it exits 0. It checks that the agent folder runs the pinned checkout, that `bun install` ran there, that `auth.json` resolves, that `herdr-core` and `hc` are on PATH and that the systemd user manager answers. Its last two lines name the pi version and the pinned commit. For a scenario the driver is its own doctor. Its exit 2 means it could not build the run, and nothing was tested.

## Drive

Follow the feature file. For a headless root, the prompt is the whole human:

- A print-mode root cannot answer a question. A turn that ends on one ends the run with exit 0, so read `reply.txt` before you trust a short run.
- Put the destination, its acceptance criteria and an autonomy grant in the human's words ("be fully autonomous, don't stop until done") in the prompt.
- A first line `/skill:<name>` expands, because the script passes the prompt as one argument.
- `GH_HOST=github.invalid` keeps `gh` off GitHub. Plant a bare `origin.git` beside the project when the run must push.

## Evidence

**Scenario.** The driver prints `evidence /tmp/pi-driver/<name>-<stamp>-<pid>` and keeps that folder: `report.txt`, `sessions/`, `probe/`.

**Headless root.** Everything stays in `$run`:

- `exit.txt`, `reply.txt` (the root's last text) and `stderr.txt`.
- `sessions/<iso>_<id>.jsonl` for the root, and `sessions/delegates/<iso>_<id>.jsonl` with `<id>.answer.md` for each delegate at any depth.
- `state/`, the run's state folders, which Cleanup moves out of the scratch HOME.

List what owned-work recorded, delegate starts and settles included:

```sh
jq -c 'select(.customType == "owned-work") | .data // empty | {type, handle, name, model, outcome}' "$run"/sessions/*.jsonl
```

Prove a claim with a session entry, never with the root's reply saying it happened. Quote the entries you cite. `/tmp` empties at reboot, so copy what a PR cites into your work's state folder.

## Cleanup

```sh
git -C "$repo" worktree remove --force "$run/checkout"
mv "$run/home/.local/state/pi-agent" "$run/state" 2>/dev/null
rm -rf "$run/home" "$run/agent"
systemctl --user list-units --plain --no-legend 'pi-ow-*' | diff "$run/units.before" -
```

`headless-root.sh` already stopped its terminal core and removed its runtime folder. When the root exits, owned-work stops its delegates' systemd scopes, so the diff shows no unit the run added. Removing `agent/` removes only the link to `auth.json`. Kill only a pid you started, never by name.

## Helpers

| Script | Invocation | What it does |
| --- | --- | --- |
| `scripts/make-agent-dir.sh` | `make-agent-dir.sh <checkout> <agent-dir>` | Links each `agent/` entry the checkout ships, links your `auth.json` and copies your `settings.json`, `models.json` and `models-store.json`. |
| `scripts/doctor.sh` | `doctor.sh <checkout> <agent-dir>` | The read-only check above. |
| `scripts/headless-root.sh` | `headless-root.sh <agent-dir> <project-dir> <prompt-file> <run-dir> <deadline-seconds> [provider/id]` | Runs `pi -p` on the agent folder in the project, with a scratch HOME, a private terminal core and every `PI_*` and `HC_*` variable of the caller unset. Stops it with SIGINT at the deadline. |

## Gotchas

- `headless-root.sh` drops every `~/.pi` folder and `node_modules/.bin` from PATH. Two harness `agent/bin` folders on one PATH make their `gh` wrappers call each other forever.
- Stop a root with SIGINT. A SIGKILL during an OAuth refresh can empty your real `auth.json`, which the run reaches through a link.
- This skill loads only in a trusted project. Your `settings.json` sets `defaultProjectTrust`, and `make-agent-dir.sh` copies it into every run.
