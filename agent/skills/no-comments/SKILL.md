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
2. Check its report and diff. Reject application-code edits, scope escapes, a comment in scope with no row, a deleted survivor, a deletion whose destination is not `delete`, a Stale row that names no checked code, a Tautology row for a comment that claims behavior its name and type do not carry and narrates no test's own step or data, and a row whose comment an earlier question in its order fits. Revert and rerun one rejected report with the failure named. Reject a second, report it open, and fail the **no-comments** skill.
3. Leave the survivors as they are. Never write a comment in place of one Comment Sicko deleted, so a false doc comment stays deleted. Move each comment Comment Sicko left for its destination, through the skill that owns it:
   - **Excuse.** A fix fits your scope when it touches only files inside the scope the caller gave. Then fix the hack at its root cause, and run the **architect** skill first when the fix needs a shape. Removing a suppression directive brings back the violation under it, so the fix fixes that violation. A fix that needs another file is an issue in the repo's tracker, filed with the **writing-good-tickets** skill and naming the symbol and its file path. Keep a suppression directive whose fix does not fit, and report it open with its issue.
   - **Definition.** Rename the symbol, narrow its type, or add the term to the repo's `GLOSSARY.md`.
   - **Constraint.** Break the claim once in the code, or for a fact about a system we cannot change, break what our code does about that fact, and run the tests, starting with any test Comment Sicko named. When a test or the type checker fails on the thing the comment claims, the claim is already held, so restore the code, delete the comment, and name that test in your report. Otherwise write the test through the **tdd** skill, see it fail on the break, and restore the code.
   - **DecisionRecord.** Check the decision against the one bar in `~/.pi/agent/skills/domain-modeling/ADR-FORMAT.md`. When it passes all three conditions and no ADR in the repo records it, write the ADR through `playbooks/documentation-and-adrs.md`. Otherwise delete the comment. Comments that record one decision share one ADR, and no ADR is written per comment or per module.
   - **Open.** Move its content where Comment Sicko says when that place is in your scope. Otherwise leave it and report it open.

   Remove each comment in the commit that lands its destination, and name the issue in that commit for an Excuse you did not fix, except a kept suppression directive, which you report open with its issue and not as a comment left behind.

4. Report the deletion count, each destination with its path or link, reruns, and every comment left open with where its content should go.
