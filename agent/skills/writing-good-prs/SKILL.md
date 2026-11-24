---
name: writing-good-prs
description: Opening a PR, or editing a live PR's title or body.
disable-model-invocation: false
---

# Writing good PRs

The PR body is the one thing you write on a PR. It is a one-minute briefing: why the change exists, what changed, what it leaves out, what it could break, and how you know it works. Comments are for human and bot reviewers, so answer a reviewer in their thread.

Write as one engineer explains a change to another, in short, simple sentences with few identifiers and only terms the reader would not stop to ask about. Edit it with the **technical-writing** skill, every layer except Diátaxis and with its STE vocabulary rules, then with the **unslop** skill. When the repository has a PR template, fill its sections instead and apply the rules below to the section that plays each role.

## Title

Follow the subject rules of **writing-good-commits**: `type(scope): subject`, imperative, completing "If merged, this PR will …", within 72 characters. Name the one change the PR makes, naming a real symbol when one carries it, bounded by what Verification proves. A title that promises "no process outlives its launcher" fails when Blast Radius names a process that still does.

## Body

```markdown
## Why

## What changed

## Scope

## Tradeoffs

## Blast Radius

## Verification
```

Use these headings in this order and drop any that would be empty, except Scope, which every body keeps because it carries the size line. Start at the first heading you keep, with no preamble, and end with no footer or attribution line, such as "Generated with". Keep the whole body under 40 lines, so at most 39 besides the size line publish-pr writes. Link swarm logs, SHA lists, metric tables, and full output instead of pasting them, and never fold them into `<details>`.

Write for a reader who has only the base branch, this diff, and the tickets the PR links, and describe the change as it stands at this PR's head. A new head changes nothing in the body: edit it only when what the PR changes or proves changes. How the work was produced, such as the earlier PRs that built it, the branches it passed through, who verified it, and the review rounds, belongs in the commit list and on the tickets. Name another PR only when this one needs it to merge, deploy, or make sense, by its number and with what it does.

Everything the body points at is reachable by any developer with access to the repository: files linked on the default branch, issues, PRs, CI runs, and hosted media. Paste what a path on your machine holds instead of naming the path. Say "before this PR" and "after this PR" rather than commit hashes.

### Why

One to three short sentences: the goal the change serves, who hits the problem, the trigger, what it costs them, and the change that removes its cause. "A reviewer delegate that greps for `pi --print` is refused, so it cannot read the guard it reviews. The guard now splits a command on `;` only outside quotes."

Then one line per ticket: `Closes #N` for a ticket this PR finishes, and `Part of #N (<what this PR does for it>)` for one it advances, with what that ticket still owes posted on the ticket. Add `Depends on #N` when another PR must merge first.

### What changed

One to three short bullets. Name a real symbol or path only when it carries the change, and name both sides of a rename.

### Before and after

A change a user can see gets a `| Before | After |` table of captures of the same screen in What changed, plus a recording of you using it from the entry point to the result when it is interactive, captured through the repository's `verify-*` skill. For a TUI or CLI, the captured pane is the screenshot and a terminal recording is the video. Caption each with what to look at.

- When the UI cannot be captured before merge, capture a local render or a preview deploy.
- When neither exists, show a component-tree `diff` and the exact on-screen text, and name the missing captures under `**Not checked:**`.
- Never draw or generate a picture of a screen you did not capture.
- After deploy, capture the real screens while you dogfood the change and edit them into the body with `scripts/publish-pr.ts edit`.

### Scope

One to three short items: what the PR covers, and what it deliberately leaves out, plus one line per known limit. `publish-pr.ts` writes the size line first, so Scope is never empty and you may leave it without items.

### Tradeoffs

Only the alternative a reviewer would otherwise propose, and the fact that rules it out.

### Blast Radius

One or two sentences. Name who or what is exposed if the change is wrong and the failure they would see. Then name the door with the fact that decides it. It is two-way when a revert undoes everything, and one-way when something survives a revert, such as migrated data, a published package, a removed public API, a sent message, or a changed default that other machines pick up. For a one-way door, say how to recover. When main is red, state the cost of leaving it red. Add what must be true before merge only when something must.

### Verification

One to three bullets, decisive proof first. Each is a command or run you made and its result, or a CI link.

- For a new regression test, give its failure without the fix and its pass with it.
- "Tests pass" and "typecheck passes" are claims. They count only with their output or a CI link.
- For a perf claim, give one `before → after` number with its unit and a link to the method, per the **benchmark-checklist** skill.

When something isn't checked, end with a `**Not checked:**` line that names each claim or Done-when item you did not check, with the reason.

## Example

The same PR, condensed from a real one and written well:

```markdown
fix(background-terminals): send pending notifications with the end

## Why

When a background terminal ends, the model never sees the notifications it had not read, so it acts on partial information. The report of the terminal's end now carries them.

Closes #73

## What changed

- A terminal's end report carries its pending notifications instead of deleting them.

## Scope

- Covers notifications still pending when a terminal ends.
- Leaves out terminals lost to a Pi restart, which drop their notifications as before.

## Tradeoffs

Sending each notification ahead of the end costs the model an extra request each, because Pi steers one message per poll.

## Blast Radius

Every session with background terminals, where a wrong batch gives the model a notification twice or not at all. Two-way door, since pending notifications live only in memory.

## Verification

- **A killed watcher's second notification reaches the model** (Done when 1). A `pi --print` run whose watcher the model kills on its first notification: `a-61 end` → `a-61 b-62 end`.
- **The regression test fails without the fix.** `test/steering.test.ts`: `✖ expected note-42 once, received 0 times` → `✔ a terminal that notifies and exits during a turn`.

**Not checked:** macOS, because the e2e suite runs only on Linux here.
```

The same PR, written badly:

```markdown
fix(background-terminals): a notification reaches the model when its terminal ends first

## Why

`delivery.terminalSettled(id)` deleted pending notifications. Now `batch("completion")` appends them and `bg_kill` lists them. This is the final PR of the stack: it carries intermediate PRs #71 and #72, and final PR B adds the docs. Closes #73.

## Verification

- The TUI reply is `a-61 end` on stack-base and `a-61 b-62 end` here.
- `vp run verify` passes.
```

Its Why lists symbols instead of a story, tells how the work was produced, and names a PR by a letter only its author knows. It has no What changed, Scope, or Blast Radius. Its Verification names a branch instead of before and after, counts "passes" as proof, and never says what it did not check.

## Check the body

Write the body to a file and run these steps in order, then publish it.

1. **Media.** Upload each screenshot, recording or other local file the body shows with the **dumpfile** skill, unless the repository hosts its own uploads, and link the URL it prints. A dumpfile link expires after 30 days, so each caption says what the media showed. Keep PR-only media out of the repository.
2. **Structure.** Run `scripts/check-body.ts pr <body-file> --title "<title>"`, with `--template <path>` when the repository has a PR template. Fix each printed problem and rerun until it exits 0. Exit 0 means the headings are in order, the title passes, Scope is there, the body is under 40 lines besides the size line, no heading but Scope is empty, and it has no `<details>`, long dash, or curly quote outside inline code and link destinations. With `--template`, the template's headings replace the six: each but Tradeoffs is required, and Scope with its size line comes only when the template has it. It also fails on a path on your machine, such as one under `~/`, even inside a code block. It says nothing about the case the body makes. A `warning:` line leaves the exit code alone. It marks a sentence about how the work was produced, or a line that may leave a choice open. Rewrite a production sentence for the reader of this diff, or keep it when that reader needs it to merge or deploy. Settle an open choice before you publish: make it when it is yours, answer it from a source, or get its owner's answer and cite it. When it cannot be settled yet, name it in Scope.

Publish the same file with `scripts/publish-pr.ts create <body-file> --title "<title>"` or `scripts/publish-pr.ts edit <number> <body-file> --title "<title>"`, never with a bare `gh pr create --body-file` or `gh pr edit --body-file`. Both verbs take `--repo` and `--template`, `create` also takes `--base` and `--head`, and `edit` also takes `--replace`. Keep the title out of the body file.

- It writes the size line `diff-size` prints first under `## Scope`, so the body file leaves it out.
- It composes the body it will send, with the size line, and runs check-body on that body with the PR's changed files, for `create` the branch diff against the base. It publishes only after check-body exits 0, and the bot sections `edit` keeps join the body after the check. A body that changes a UI file, such as `.tsx` or `.css`, fails without a `| Before | After |` table or a `**Not checked:**` line that names the missing screenshots.
- On `edit`, it drops each live section under a heading the harness writes, the six above plus Evidence, Risk, and Before and after, even with a suffix such as `(head b7e6a48d)`, and prints `publish-pr: dropped "## <heading>" from the live body` for each. It keeps each other `## ` section that the live body has and the file lacks, such as a plan or summary a bot appended, after the section it followed in the live body, and prints `publish-pr: kept "## <heading>" from the live body` for each. To delete such a section on purpose, pass `--replace`, so the file replaces the live body whole, and say so in your report.
- It reads the PR back and compares it with what it sent, ignoring line ends and trailing newlines. On a difference it prints the changed lines.

Its exit code is 0 when the PR is published and reads back the same, 1 when check-body found problems, 64 for a bad argument or an unreadable body or template file, 2 when a `gh` or `git` call failed or check-body could not run, and 3 when the readback differs.
