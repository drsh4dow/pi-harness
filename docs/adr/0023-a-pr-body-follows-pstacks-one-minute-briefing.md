---
status: proposed
---

# A PR body follows pstack's one-minute briefing

Commits 522fcbb2 ("a PR body proves its outcome without a clone") and 5b116583 ("prove each claim for an expert who must own it") put the proof inside the PR body, so a reviewer could trust a change without cloning it. Each claim got a witness run at the PR's head with its output before and after, an Evidence `<details>` block answered the questions an expert would ask, What changed needed a visual, and a cold-reader delegate checked the body. A retro of 1,666 sessions measured the cost. The median body had 877 words, six times pstack's one-minute briefing. 245 of 470 body edits had no code change behind them, most of them witnesses rewritten for a new head. Half the PRs got a cold read, and check-body ran 658 times with 105 failures.

So the body follows pstack's rule (pstack 0.15.48, `poteto-mode/playbooks/opening-a-pr.md`): "a one-minute briefing under 40 lines with these `##` headings in order, dropping empty ones: `## Why`, `## What changed`, `## Scope`, `## Tradeoffs` (only rejected alternatives a reviewer would otherwise ask about), `## Blast Radius`, `## Verification`." The Evidence block, the required visual, the witness rerun at each head, and the cold read are gone. Proof that does not fit goes behind a link, as pstack's technical-writing skill says: "Do not paste swarm logs, SHA lists, or metric tables. Link them." A new head changes nothing in the body. One heading departs from pstack: Scope is required, because it carries the size line that ADR 0019 has publish-pr write, so it is never empty. A repository's PR template replaces these headings, as on main, so a template without Scope gets no Scope and no size line. check-body enforces the heading order, the Scope heading, under 40 lines (at most 39 besides the size line), no other empty heading, no `<details>`, and no long dash or curly quote outside code and links (unslop rules 13 and 19). publish-pr writes the size line under the body's own Scope and adds no heading, and on edit drops the harness's own stale sections while keeping a bot's. It runs check-body on the body it composes, before a bot's sections join it, not on the draft it was given, so nothing it adds can carry a body past the checks. The body still goes through technical-writing and unslop, as pstack routes PR descriptions.

## Considered options

- **Insert a Scope section when a body has none.** Dropped after review. Every insertion point in authored text, such as a heading inside a code fence, needed its own guard, and a required Scope needs none.
- **A 20-line brief of Why, What changed, Verification, and Risk for a one-way door, with a 200-word cap.** Rejected by the human: it lost Scope, Tradeoffs, and Blast Radius, which reviewers used.
- **A "Verified at <sha>" line that publish-pr writes from the merge gate's verdict records.** Dropped. pstack has none, and the verdict ledger already holds every verdict.
- **Keep the Evidence block with a cap.** Rejected. Its hidden half held a median of 353 words, and its witnesses were what got rewritten at each new head.

## Consequences

- The body no longer answers every question an expert might ask. They follow its links or clone the branch.
- Unslop rule 7's word list stays a judgment in the unslop pass. A script cannot tell "landscape" as a page orientation from the abstract use the rule bans.
- No second model reads the body. check-body's warning is the only catch for a sentence about how the work was produced.
