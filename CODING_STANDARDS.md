# Coding standards

The pi harness, built on pi and Herdr-Core. This repo is also pi's live config folder, `~/.pi`, so `.gitignore` is an allowlist for `agent/`.

## Layout

One runtime, the bun process that pi and the bin commands run in, so `src/` is the runtime directory. pi loads entry files by path, so they stay outside `src/` (`docs/adr/0014-src-layout-held-by-dependency-cruiser-bans-and-a-comment-check.md`).

| Noun                   | Place                                                    | Job                                                                      | Imports                                                                      |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Entry file (extension) | `agent/extensions/<name>/index.ts`                       | Wires one feature into pi, which discovers the folder                    | one feature's or client's `index.ts`                                         |
| Entry file (command)   | `agent/bin/<name>.ts` and its shim                       | Wires one feature into argv                                              | one feature's or client's `index.ts`                                         |
| Feature                | `src/features/<name>/`                                   | One piece of harness behavior. Its edge file is `index.ts`               | its own files, other features' and clients' `index.ts`, `src/primitives/`    |
| Client                 | `src/client/<name>/`                                     | The adapter to one outside system, and the one writer of a durable value | its own files, other clients' `index.ts`, `src/primitives/`                  |
| Pi host                | `src/client/pi-host/`                                    | The one place that runs an Effect                                        | as a client                                                                  |
| Git                    | `src/client/git/`                                        | Runs git with the caller's `GIT_*` variables dropped                     | as a client                                                                  |
| Primitives             | `src/primitives/`                                        | Knows no feature, owns no state                                          | nothing else from the repo                                                   |
| Inner module           | any folder inside a feature, a client or `tools/<name>/` | A concept with its own `index.ts`                                        | its own files, files directly in an ancestor folder, a sibling `index.ts`    |
| Test code              | `*.test.ts`, `*.fixture.ts`, `*.scenario.ts`             | Sits beside its subject                                                  | its own folder, `index.ts` files, `src/primitives/`, `tools/driver/index.ts` |
| Dev tools              | `tools/<name>/`                                          | The scenario driver, the gates, reports                                  | the harness only through an `index.ts` or `src/primitives/`                  |

`herdr/`, and the `scripts/`, `templates/` and `cli/` folders shipped inside skills and playbooks, are outside the map.

Each durable value has one writer:

| Value                                                                                 | Writer                                                                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| pi session files                                                                      | pi. One feature per custom entry type: state-folder, cache, usage, owned-work, claude-accounts. Branched sessions: `src/client/pi-sessions/` |
| hc terminal labels                                                                    | `src/client/hc/`. One feature per key: `pi.context` loaded, `pi.cost` cost, `pi.state` state-folder, `ow.group` and `herdr.space` owned-work |
| the default model in `agent/settings.json`                                            | pi, through `setModel`, called only from claude-accounts                                                                                     |
| git objects and fetches                                                               | `src/client/git/`                                                                                                                            |
| GitHub merges                                                                         | `src/client/gh/`                                                                                                                             |
| verdicts, check receipts and queues, the web cache                                    | `src/client/verdicts/`, `src/client/checks/`, `src/client/web-cache/`                                                                        |
| delegate staged files, the reply file, systemd units, hc terminals, the heartbeat log | `src/client/pi-cli/`, `src/client/pi-sessions/`, `src/client/systemd/`, `src/client/hc/`, `src/client/heartbeat/`                            |
| driver run folders, the ast-grep budget, `system-prompts.md`                          | `tools/driver/`, `tools/gates/budget.ts`, `tools/prompts/`                                                                                   |

These registries stay, since each is a selection, or a tool fails on a missing entry:

- `childExtensions` in `src/features/owned-work/child.ts` picks the extensions delegates load.
- `knip.jsonc` entries and the default-export override in `.oxlintrc.jsonc` list the files pi loads by path.
- A new top-level source folder needs a place in the `lint`, `boundaries` and `width` scripts of `package.json`, in `include` of `tsconfig.json` and in `project` of `knip.jsonc`. Nothing catches a folder left out.

## Growth

A file holds at most 600 lines, and a folder holds at most 20 entries, counting the files and folders directly in it.

**The folder rule.** A file over the cap becomes a folder named for its concept. What its callers use moves to the folder's `index.ts`, and its parts become modules inside. It never becomes a suffixed sibling such as `report-utils.ts`. A folder over the cap groups its files into such folders, one per concept. The tests of an `index.ts` count like any other file, and when they crowd the folder they go into folders named for the behavior they exercise.

**The split order.** Place each part of a file or folder over its cap by the first question that fits:

1. Does it know no feature and no outside system, and own no state? It goes to `src/primitives/`.
2. Does it write a durable value or know an outside system? It goes to `src/client/`.
3. Is it a concept with its own interface? It becomes an inner module, with its tests inside.
4. Is the file one concept that the user granted an exception? It stays whole.

What is left is what the callers use, and it stays in `index.ts`.

## Rules a gate enforces

`bun run check` runs every gate below. A rule here needs no reminder, only the gate's message when it fails.

| Rule                                                                                                                                         | Gate                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code is formatted                                                                                                                            | `oxfmt --check`                                                                                                                                              |
| Every stable oxlint rule holds, and each rule that is off has its reason beside it                                                           | `bun run lint`, `.oxlintrc.jsonc`, `oxlint-effect.json`                                                                                                      |
| Types are strict, and TypeScript syntax is erasable                                                                                          | `bun run lint`, which reports compiler errors as `typescript(TS…)`, `tsconfig.json`                                                                          |
| A file holds at most 600 lines                                                                                                               | oxlint `eslint/max-lines`                                                                                                                                    |
| A function takes at most 3 parameters, and pi's handlers in `src/features/owned-work/tools.ts` and `src/features/skill-menu/index.ts` take 5 | oxlint `eslint/max-params`                                                                                                                                   |
| A folder holds at most 20 entries                                                                                                            | `bun run width`, `tools/width.sh`, `size-limits.txt`                                                                                                         |
| Code outside a folder imports only its `index.ts`, at every depth of `src/` and `tools/`                                                     | `bun run boundaries`, rules `edge-file` and `tools-edge-file` in `.dependency-cruiser.json`                                                                  |
| A feature imports its own files, another feature's or a client's `index.ts`, and `src/primitives/`                                           | `bun run boundaries`                                                                                                                                         |
| A client imports its own files, another client's `index.ts`, and `src/primitives/`                                                           | `bun run boundaries`                                                                                                                                         |
| `src/primitives/` imports nothing else from the repo                                                                                         | `bun run boundaries`                                                                                                                                         |
| An entry file imports only a feature's or a client's `index.ts`                                                                              | `bun run boundaries`                                                                                                                                         |
| Production code never imports test code or the PHI eval corpus, and nothing imports a scenario                                               | `bun run boundaries`                                                                                                                                         |
| Only `piHost` in `src/client/pi-host/` runs an Effect                                                                                        | oxlint `no-restricted-properties`                                                                                                                            |
| Only `src/client/` touches disk, HTTP or a child process                                                                                     | oxlint `no-restricted-imports`, `no-restricted-properties`                                                                                                   |
| Only `src/client/git/` runs git                                                                                                              | `tools/ast-grep/rules/no-raw-git.yml`                                                                                                                        |
| Test code waits on a condition with `eventually`, never a fixed sleep                                                                        | oxlint `no-restricted-properties`                                                                                                                            |
| Only entry files read the environment                                                                                                        | oxlint `node/no-process-env`, and `no-restricted-properties` on `Bun.env`                                                                                    |
| owned-work resolves a delegate's model with `modelOf`                                                                                        | `tools/ast-grep/rules/delegate-model-lookup.yml`                                                                                                             |
| A source file holds no comment but a `/// <reference` line or a license header at the top of the file                                        | `tools/ast-grep/rules/no-comments.yml`                                                                                                                       |
| Imports sit at the top of the file                                                                                                           | `tools/ast-grep/rules/no-dynamic-import.yml`                                                                                                                 |
| Relative imports end in `.ts`                                                                                                                | `tools/ast-grep/rules/relative-import-extension.yml`                                                                                                         |
| No unused file, export or dependency                                                                                                         | `bun run knip`, `knip.jsonc`                                                                                                                                 |
| Violations that predate a rule only fall                                                                                                     | oxlint with `oxlint-suppressions.json`, `bun run sg` with `tools/gates/ast-grep-budget.json`, `bun run width` with the `baseline` lines of `size-limits.txt` |
| A test's git commands never reach a repository git exported to the suite                                                                     | the `test` script, `tools/gates/git-env.test.ts`                                                                                                             |
| Each gate fails on a fixture that breaks it                                                                                                  | `tools/gates/gates.test.ts`                                                                                                                                  |
| Credentials and session history stay out of git                                                                                              | the allowlist `.gitignore`                                                                                                                                   |

## Lowering a baseline

Each baseline holds the violations that predate their rule, and each count may only fall. Its gate fails once a count drops, until you commit the lower one with the fix that lowered it.

- **oxlint**: run `node_modules/.bin/oxlint src tools agent/extensions agent/bin --prune-suppressions` and commit `oxlint-suppressions.json`.
- **ast-grep**: run `bun tools/gates/budget.ts --write` and commit `tools/gates/ast-grep-budget.json`. Remove a comment only through the **no-comments** skill, which moves what it says to where it belongs.
- **width**: set the folder's line in `size-limits.txt` to the count `bun run width` prints, or delete the line once the folder holds 20 entries or fewer.

The baseline files key each entry by file path, so a move renames the path in all three.

## Rules that need judgment

- **A gate that fails caught something.** Fix the code. When a rule is wrong for this repo, such as an Effect or pi idiom it rejects, take it to the user with what it flags and your pick. A rule goes off only with their approval, or when files prove that no spelling satisfies it and another rule together. Its off line in `.oxlintrc.jsonc` names the reason, and the idiom joins `tools/oxlint/fixtures/effect-pi-idioms.ts`. An exception for one file is an override in `.oxlintrc.jsonc` or a line in `size-limits.txt`, with its reason.
- **Each durable value has one writer.** A new file, store or label gets its folder in `src/client/` before a feature writes it, and every writer calls that client.
- **New product work adds a folder.** A new piece of behavior goes in `src/features/<name>/`, with its entry file in `agent/extensions/<name>/index.ts` or `agent/bin/<name>.ts`.
- **Tests run in parallel workers.** A test shares no fixed path, port or process with another file.
- **A fact about the harness at runtime needs a scenario.** Prove it with a `*.scenario.ts` run by the driver, as `tools/driver/README.md` describes, not with a unit test or a reading of the code. For what a whole root run does under a prompt, follow `.pi/skills/verify-pi-harness/SKILL.md`.
- **The harness itself follows pi's docs.** Before you change an extension, `SYSTEM.md`, a role file or a principle, read `node_modules/@earendil-works/pi-coding-agent/README.md` and its `docs/` and `examples/`.
- **Prompt changes get a look at the result.** After changing `SYSTEM.md`, a role file, a principle, an extension's prompt guidelines or a file in `agent/instructions/`, run `bun run prompts [project-dir]`. It writes `system-prompts.md` (gitignored) with the full prompt each kind of agent gets. Every agent but stock pi runs on this checkout's `agent/`, so a git worktree shows its own prompts.
- **A prompt file names a model by its alias.** A skill, playbook, role or instructions file names an alias from `src/features/owned-work/models.ts`, never a model id.
- **A read-only profile says so in words too.** `readonly: true` drops only the `edit` and `write` tools and bash still writes, so its instructions tell the delegate to edit nothing.
- **An extension with its own `package.json`** lists the packages pi supplies at runtime (`@earendil-works/pi-*`, `typebox`) in `peerDependencies` with `"*"`.
- **Vendored code keeps its upstream.** `tools/oxlint/anti-slop/` changes only by rerunning the upstream install script its `UPSTREAM.md` names, at the commit it records. The code inside skills and playbooks (`scripts/`, `templates/`, `cli/`) is outside oxfmt and oxlint, and `bun run test` still runs its tests.
- **Herdr-App and Herdr-Core** follow `~/.config/herdr-app/AGENTS.md`. Read it before you change them.
