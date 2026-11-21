---
name: dunify
description: Set up a new codebase in the Dune style, or move an existing one to it, so its layout and its checks constrain what an agent can write.
disable-model-invocation: true
for: [root]
---

# Dunify

Change the repo so that the shortest path an agent can take is the correct one. Dune, the Grok Bot team's client framework, gets there with two things, and you install both: a **layout** of deep modules whose folder names carry rules, and a **ceiling** of checks that reject everything else. A run ends with both in place and every violation they found fixed.

Judge every choice below against Dune's five rules:

1. The conventional path requires fewer decisions than a shortcut.
2. Forbidden dependencies fail mechanically.
3. Every durable value has one obvious writer.
4. New product work adds isolated files rather than branches in shared roots.
5. Exceptions are narrow, explicit, and reviewed as architecture changes.

## The layout

Name everything with the vocabulary of the **codebase-design** skill: module, interface, seam, adapter, depth, leverage and locality. Read [its SKILL.md](../codebase-design/SKILL.md) before you draw the map.

A **runtime directory** is named for where its code runs, such as `electron-main`, `server` or `worker`. It sits inside the language's source root. A project with one runtime uses the source root itself. Runtime directories never import each other, types included.

The **contract** is `shared/`, beside the runtime directories. It appears with the second runtime and is the interface at the seam between two runtimes. It holds types and schemas and no logic, one edge file per contract, with typed arguments and typed failures. It is the only thing two runtime directories both import.

Inside a runtime directory there are three names. A runtime carries only the ones it needs.

| Name               | Job                                                                                                                                           | Imports                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `features/<name>/` | A module for one piece of product work. Its edge file is its interface, and the only file another feature may import.                         | Its own files, another feature's edge file, `client/`, `primitives/`, `shared/` |
| `client/`          | The adapters at the seams to outside systems and other runtimes, and the one writer of each durable value. Features call its named functions. | Its own files, `primitives/`, `shared/`                                         |
| `primitives/`      | Modules that know no feature and no outside system, and own no state.                                                                         | Its own files, nothing else from the app                                        |

A runtime with neither `client/` nor `primitives/` holds its owned folders directly, with no `features/` level.

Every folder inside a feature, a client or `primitives/`, at any depth, is a module with one edge file as its interface. Code outside a folder imports only that folder's edge file. The language reference names the edge file.

Dune's tree is the worked example:

```
src/
  electron-renderer/
    features/reports/index.ts
    client/reports-store.ts
    primitives/
  electron-main/
    startup/
    notifications/
    update/
  shared/reports-rpc.ts
```

A runtime's **entry file** sits at the root of its runtime directory. It starts the runtime and may import anything inside it. A noun that fits none of the three names, such as a migration or a scheduled job, enters through the layout map with a row of its own. Files outside the source root, such as tool configs, scripts and gate fixtures, are outside the map.

### Growth

A file holds at most 600 lines, and a folder holds at most 20 entries, counting the files and folders directly in it.

**The folder rule.** A file at the cap becomes a folder named for its concept, with the old file as its edge file. It never becomes a suffixed sibling such as `report-utils.ts`. A folder at the cap groups its files into such folders, one per concept. The tests of an edge file count like any other file, and when they crowd the folder they go into folders named for the behavior they exercise.

**The split order.** Place each part of a file or folder at its cap by the first question that fits:

1. Does it know no feature and no outside system? It goes to `primitives/`.
2. Does it write a durable value or know an outside system? It goes to `client/`.
3. Is it a concept with its own interface? It becomes a sub-module, with its tests inside.
4. Is the file one concept? It stays whole.

[SHALLOW-SIGNALS.md](../codebase-design/SHALLOW-SIGNALS.md) nominates the groups. Decide each one by reading the code.

## The ceiling

The **ceiling** is every stable lint group at error, every plugin that fits the stack, the type checker's strictest mode, and the formatter in check mode. It includes the groups whose own docs say to hand-pick from them, such as `restriction` in oxlint and clippy. Unfinished groups, such as nursery and preview, stay off as a group.

A rule goes off in one of two ways:

- A **collision** is two rules, or a rule and the formatter or compiler, that no spelling of a construct can satisfy together. Write each spelling, run the tools on them, and when every one fails a side, turn one side off yourself. A pair that only forbids the construct is a ban, so it goes to the user.
- Every other rule you want off goes to the user in one list, with what it flags here and your pick. It stays on until they answer. An option that narrows a rule and a setting that turns a rule off for some files are each a rule turned off, so they go in the same list.

The linter's config is the **ledger**. Each rule that is off carries a one-line reason beside it, which names the collision pair or the user's approval. The ledger starts with the size rules the language reference names. The file cap rule is set to 600 lines. The rules that cap a function's length or its statement count are off, with the reason "the user's standing choice". The rules for complexity, nesting depth and parameter count stay on.

No linter ships these four gates, so you build them:

- **Boundaries** reject every import the layout map does not allow, and every import that reaches past a module's edge file, at any depth.
- **Bans** reject an API that takes judgment to use well, such as an effect hook, a raw timer or a transport call. Each ban names one **owner**, the single file or folder allowed to use the API, and its message names the function to call instead. Write that function in the owner before you add the ban. A ban holds inside its owner's runtime directory, so its message never points across a boundary.
- **The comment check** rejects every comment in a source file except a license header at the top of the file, a `#!` line on line 1 of a file and a `/// <reference` line. Doc comments and tool directives are comments too. Linter config files are exempt. Each `//` line is its own comment, so when you build the comment check, rewrite a license header of `//` lines as one block comment, which the rule passes whole.
- **Width** fails when a folder under the source root holds more than 20 entries, and its message names the folder rule. Copy [`scripts/width.sh`](scripts/width.sh) into the repo, such as to `tools/width.sh`, and run it as `sh tools/width.sh width-exempt.txt <source root>...`. It skips what git ignores, such as `__pycache__`. Commit `width-exempt.txt` beside it, empty or with one line per folder of test data, its path, a space, and the reason.

## Steps

### 1. Read and measure

For a new repo, ask the user for the language, the app kind, and any framework they have already picked. Pick none yourself. Stop until they answer.

Read the reference for each language the repo uses: [`references/typescript.md`](references/typescript.md), [`references/effect.md`](references/effect.md) when `effect` is a dependency, [`references/rust.md`](references/rust.md), [`references/python.md`](references/python.md), and [`references/other.md`](references/other.md) for any other language. Read [`references/ui.md`](references/ui.md) as well when the repo has a web UI.

For an existing repo, measure before you read. Get each of these from a command:

- the lines of source per build module or top-level folder, without tests and generated code;
- the edges between those modules that production code uses, from the build tool or an import graph;
- the commits of the last 90 days per module;
- the build and test commands CI runs, whether each passes on the untouched tree, and how long each takes;
- each folder the width gate fails and each file over the cap, with the nominations of [SHALLOW-SIGNALS.md](../codebase-design/SHALLOW-SIGNALS.md) for each;
- the violations of each rule with the ceiling, the size rules, the comment check and the width gate on, counted per rule, from a scratch config outside the repo.

Stop and tell the user when the build or the tests fail or cannot run on this machine, since no move can be checked against a red tree. A green CI run of the same commit counts as a pass.

Past about 20,000 lines of source, one agent cannot read the repo and one branch cannot carry the change. Read [`references/large-repo.md`](references/large-repo.md) now and follow it through every step.

Then list with paths:

- each place code runs;
- each durable value, such as a store, a table, a cache or a file, and every place that writes it;
- each registry, meaning a file that every new feature of one kind must edit;
- the check command, the CI config, the linter, type checker and formatter configs, and every rule already off.

Done when the user has answered for a new repo, or every runtime, durable value, registry and gate config of an existing repo is named and every rule has its count.

### 2. Draw the map and stop once

Write the **layout map**, one row per noun:

| Noun | Place | Job | Writer | Imports |
| ---- | ----- | --- | ------ | ------- |

Give a row to each runtime directory, its entry file, each feature, each file or module in `client/` with the value or system it owns, `primitives/`, each contract edge, and each noun of the project's own. For an existing repo, place every source file in a row by the folder rule and the split order.

Under the map, list:

- **The bans**, each with its API, its owner and its message. For an existing repo, seed them from mistakes that happened twice, found the way the **correct** skill finds mistake classes, and then from the language reference. For a new repo, seed them from the language reference. Propose a ban only for an API the code calls today or the first feature will call, so every owner has a caller. A mistake that is a missing call is no ban. List it under the five rules as a gap.
- **The hot spots**, one per registry. Where the stack discovers files in one line, such as a glob import, plan to replace the registry with it. A registry stays when the compiler rejects a missing entry, or when the stack has no such discovery, and is named here.
- **The five rules**, each with the row or gate that upholds it. A rule with none is a gap, and you say so.
- **The rules off.** List the rules from the installed tool, since any list written down is already stale. Settle each collision yourself with files that prove it, kept outside the repo, before any auto-fix runs, since a fix settles a collision by deleting code. Then list every other rule you want off with its count from step 1, what it flags here and your pick, and each file over the cap that is one concept as an exception. End with the count of every rule that stays on, which the burn-down fixes.

Show all of it to the user in one message and stop. Done when the user approves the map, the bans and the rules off. No later step stops for the user.

### 3. Raise the ceiling and build the gates

For a new repo, create the tree first and write one small feature that calls `client/`, and that crosses a contract edge when there are two runtimes. Later features copy it, so it passes every gate before you hand back.

Turn every stable rule on as each language reference says, and write the ledger with each reason the user approved. Build boundaries, bans and width with the tools the language reference names. Build the comment check as an ast-grep rule, shaped like this one for TypeScript:

```yaml
id: no-comments
language: TypeScript
severity: error
message: Delete this comment. Say it with a name, a type, a test, an issue or an ADR.
rule:
   kind: comment
   not:
      any:
         - regex: '^///\s*<reference '
         - all:
              - regex: '^(//|/\*)[\s\S]*(Copyright|SPDX-License-Identifier)'
              - inside: { kind: program }
              - not: { follows: { not: { any: [kind: comment, kind: hash_bang_line] }, stopBy: end } }
```

`ast-grep scan --rule <file> <source root>` exits 1 on a match. The first exclusion lets a `/// <reference` line pass. The second lets a license header pass only at the top of the file. The language reference gives the `language` and the comment kinds.

Every message names the owner, the edge file, the folder rule or the function to use. For each gate, write a fixture that breaks it and a test that expects the gate to fail on the fixture. Keep both, with the fixtures outside every path the check scans. Where a gate matches by path, the test copies the fixture into that path and removes it afterward.

Done when every stable rule is on, every rule that is off has its line in the ledger, and each gate has failed on its fixture in a real run, with its message in the output.

### 4. Record the baseline and wire the check

Skip the baseline for a new repo.

Run every auto-fix. A fix that trips another rule is a collision, so settle it as in step 2. Then record a **baseline**, a committed count of the violations left, per file and rule, that may only fall. Use the tool's own baseline where the language reference names one. Where it names none, write a budget script in the project's language:

- it reads the tool's JSON output and counts violations per file and rule;
- it fails when any count is above the committed one;
- it fails when a count is below the committed one, and tells the reader to commit the lower count.

The width gate's baseline is a line in `width-exempt.txt` for each folder it fails today, with the reason `baseline`.

The baseline replaces suppression directives, which the comment check rejects. Count every existing comment in the baseline with the other violations, so it is burned down with them. Remove comments only through the **no-comments** skill, which moves what each one says to its destination.

Make one `check` command that runs the formatter in check mode, the linter, the type checker, the four gates, the baseline and the tests. Add a CI job that runs the same command when the repo already has CI.

Write two files with the **writing-for-agents** skill:

- `AGENTS.md` holds the check command and one line that says when to read `CODING_STANDARDS.md`.
- `CODING_STANDARDS.md` holds the layout map, the folder rule and the split order, then one table that pairs each rule with the gate that enforces it, then the rules that need judgment and so have no gate.

When an `AGENTS.md` already exists, move its instructions into `CODING_STANDARDS.md`, and delete each line that a gate now enforces or that a config file already states.

Done when `check` exits 0 on a clean checkout after its install step, fails after you add one violation of a baselined rule, and the work is committed.

### 5. Burn the baseline down

Skip this step for a new repo.

The baseline is the queue. Up to about 20,000 lines of source, run this step under `playbooks/autonomous-run.md`, with this step's done line as the exit condition. Past that, run it under `playbooks/orchestrate.md`, with the slices of `references/large-repo.md`.

Give each module in the map one owner delegate, in its own worktree, on a branch cut from the last accepted one. Order the modules by fewest importers first. Start together only modules with no import between them and no importer in common. Give each owner:

- its rows, the language reference, the `check` command, the folder rule and the split order;
- what done means. Every file of the module sits in its row's place, and a file that mixed two rows is split between them. Each of the module's baseline entries is fixed at its cause, so its counts are zero. The **no-comments** skill has run on the module. `check` exits 0, and the work is committed.

The ledger, the gate rules, the `check` command and `CODING_STANDARDS.md` are yours alone. An owner edits its module's files and its baseline counts. Outside its module it changes only the lines that name a moved file, in the importers and in the build's module list, with one scripted rewrite. It reports any other change it needs in its answer.

An owner's answer is a claim. Read its diff and run `check` on its branch before you accept it, and rebase each accepted branch onto the one before it. Replace each registry the map plans to replace. An issue the **no-comments** skill files for an excuse joins the queue.

No suppression, no rule turned off and no cap raised without the user. For a question that comes up after the stop, pick the answer that keeps every rule on, carry it out, and record the question and your pick in `USER_ACTION_ITEMS.md`.

Once every module has moved, run the **copy scan** once over the source root:

- each name declared at the top level in two or more owners, meaning features, client modules and `primitives/`, where the texts look alike;
- each clone of 30 tokens or more from `npx jscpd --min-tokens 30 --reporters json --output <scratch folder> <source root>` whose two sides sit in different owners, leaving out clones of import lines.

A hit nominates. Read both sides, and give each real copy one home by the split order, with every caller pointed at it. Most real copies belong to a client, not to `primitives/`.

Done when every baseline count is zero, `width-exempt.txt` holds no `baseline` line, every planned registry is replaced, and each real copy has one home.

### 6. Hand back

Delete the baseline files and the budget script, and make `check` run each tool raw, as the language reference's check command shows.

Done when `check` exits 0 on a clean checkout and the work is committed.

**Reply:** the layout map as built, the ledger with each reason, each rule's count at step 1 beside its count now, each real copy with its home, the registries that stay, and what `USER_ACTION_ITEMS.md` holds. Name the next skills: **correct** whenever the user corrects an agent, and **create-verification-skill** to prove behavior at runtime.
