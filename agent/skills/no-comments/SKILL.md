---
name: no-comments
description: Before you ask for review of your own diff, or asked to remove or audit code comments.
for: [root, owner]
---

# No comments

Spawn Comment Sicko, check its verdicts, and move each comment it leaves to its destination.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

## Steps

1. Spawn a delegate with `instructionsFile: ~/.pi/agent/instructions/comment-sicko.md`. Pass the scope. Do not restate its rules.
2. Check its report and diff. Reject application-code edits, scope escapes, a comment in scope with no row, a deleted survivor, a deletion whose verdict is not `delete`, a Stale verdict that names no checked code, and a verdict an earlier question in its order fits. Revert and rerun one rejected report with the failure named. Reject a second, report it open, and fail the **no-comments** skill.
3. Move each comment Comment Sicko left to its destination, through the skill that owns it:
   - **Excuse.** File an issue in the repo's tracker with the **writing-good-tickets** skill. The issue names the symbol that carries the hack.
   - **Definition.** Rename the symbol, narrow its type, or add the term to the repo's `GLOSSARY.md`.
   - **Constraint.** Pin it with a type, or with a test through the **tdd** skill.
   - **DecisionRecord.** Check the decision against the one bar in `~/.pi/agent/skills/domain-modeling/ADR-FORMAT.md`. When it passes all three conditions and no ADR in the repo records it, write the ADR through `playbooks/documentation-and-adrs.md`. Otherwise delete the comment. Comments that record one decision share one ADR, and no ADR is written per comment or per module.

   Remove each comment in the commit that lands its destination, and name the issue in that commit for an Excuse. Removing a suppression directive brings back the violation under it, so fix the violation in the same commit, or keep the directive and report it open with its issue.

4. Report the deletion count, each destination with its path or link, reruns, and every comment left open with where its content should go.
