---
name: no-comments
description: Before you ask for review of your own diff, or asked to remove or audit code comments.
for: [root, owner]
---

# No comments

Spawn Comment Sicko, check its rows, and move each comment it leaves to its destination.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

## Steps

1. Spawn a delegate with `instructionsFile: ~/.pi/agent/instructions/comment-sicko.md`. Pass the scope. Do not restate its rules.
2. Check its report and diff. Reject application-code edits, scope escapes, a comment in scope with no row, a deleted survivor, a deletion whose destination is not `delete`, a Stale row that names no checked code, a Tautology row for a rule that names no test or type, and a row whose comment an earlier question in its order fits. Revert and rerun one rejected report with the failure named. Reject a second, report it open, and fail the **no-comments** skill.
3. Leave the survivors as they are. Move each other comment Comment Sicko left to its destination, through the skill that owns it:
   - **Excuse.** Fix the hack at its root cause when the fix fits your scope, and run the **architect** skill first when the fix needs a shape. Otherwise file an issue in the repo's tracker with the **writing-good-tickets** skill, naming the symbol that carries the hack. Removing a suppression directive brings back the violation under it, so fix that violation.
   - **Definition.** Rename the symbol, narrow its type, or add the term to the repo's `GLOSSARY.md`.
   - **Constraint.** Pin it with a type, or with a test through the **tdd** skill. The rule holds today, so break it once to see the test fail, then restore it.
   - **DecisionRecord.** Check the decision against the one bar in `~/.pi/agent/skills/domain-modeling/ADR-FORMAT.md`. When it passes all three conditions and no ADR in the repo records it, write the ADR through `playbooks/documentation-and-adrs.md`. Otherwise delete the comment. Comments that record one decision share one ADR, and no ADR is written per comment or per module.
   - **Open.** Move its content where Comment Sicko says when that place is in your scope. Otherwise leave it and report it open.

   Remove each comment in the commit that lands its destination, and name the issue in that commit for an Excuse you did not fix.

4. Report the deletion count, each destination with its path or link, reruns, and every comment left open with where its content should go.
