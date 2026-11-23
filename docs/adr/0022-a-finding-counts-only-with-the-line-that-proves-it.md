---
status: proposed
---

# A finding counts only when its reporter writes the line that proves it

Amends the first rule of ADR 0011.

ADR 0011 made a finding that blocks nothing a known limit, and agents still reported most edge cases and fixed them. Three things kept the loop alive. The rule bound only the author, while the reviewer's instructions asked whether edge cases were handled, filed "poor error handling" under Required, and failed the verdict on any Required finding. The merge gate refuses a merge without a pass verdict, so the author had to fix the edge case to merge. The rule also made blocking the default, because "no user would hit it in good faith" asks for proof of a negative. And each fix added code with edge cases of its own, so the work did not converge.

So the harness chose four rules, and the triage-findings principle holds them:

- A finding counts when its reporter writes one of three lines beside it. `Fails` names the acceptance criterion, gate or doc line it fails. `Path` names the user, what they do through the real entry point, and what they then see or lose. `Harm` names what cannot be undone, such as lost data, a leaked secret or moved money, and it counts however rare it is. Any other finding is a known limit.
- Only a finding that counts is Critical or Required in a review, so only it fails a verdict. The reviewer's template carries the line under each such finding, and gives cuts and known limits their own headings.
- The same bar applies before an author adds a guard or a branch for a case no acceptance criterion names.
- A fix removes the path first, rejects the input at the boundary second, and handles the case last.

## Considered options

- **A principle for the author alone.** Rejected. The merge gate needs a pass verdict, so a rule the reviewer does not apply cannot stop the fix.
- **A severity scale that blocks above a level.** ADR 0011 rejected it because it asks the agent that found a bug to grade it. A line asks for evidence instead of a grade, and a reader can check it.
- **A run that proves every finding,** as the interrogate skill asks. Rejected for a review. A reviewer of a design or a UI often has no cheap run.
- **No `Harm` line.** Rejected. An attacker is not a user in good faith, and a crash in the middle of a write is on no user's path, so the bar would pass security and data-loss findings.
- **A reviewer that counts known limits without listing them.** Not chosen. A listed known limit keeps the one line ADR 0011 gives it. Whether a list leads the author to fix what it holds is untested.

## Consequences

- A real bug whose path the reviewer cannot write is a known limit until someone writes the path.
- A missing test counts only when the behavior it would guard counts.
