---
status: proposed
---

# A cut never blocks, and a cut pass applies it

ADR 0011 made a finding that blocks nothing a known limit with no fix, so agents stop looping on edge cases. That rule also left structural findings with no path to a fix. A copy of logic, a module that fails the deletion test, or 300 lines where 80 would do fails no acceptance criterion, gate or doc line, so a reviewer could only record it. Each author graded its own simplification pass, and no step read the combined diff of parallel slices. A retro of long autonomous runs read 29 review findings and found none about size, duplication or design. In 4 of its pull requests, about 13% of the added production lines were judged unnecessary, and review fix rounds added 140 of them.

So the harness separates a cut from a known limit:

- A cut is a finding whose fix removes more production code than it adds and keeps behavior. A listed finding whose fix cannot do that is no cut, so it takes the known-limit rule like any other finding. A cut pass reports each cut's `diff-size` line and a green check. Its branch takes the same verdict as any slice, and that verdict confirms the behavior kept. A cut is never a known limit, never holds a slice up, and gets no ticket. The shared prompt layer says this once, beside the known-limit rule.
- A reviewer lists each cut in its verdict, and the root hands it to the next cut pass. A cut pass is one owner, started from `agent/instructions/cut-pass.md`, that applies cuts across the combined diff of a wave. Work of three or more slices runs one after each wave lands and once before the handoff pull request, and the next wave does not wait for it. Smaller work hands its cuts to the simplification pass the feature playbook runs before the pull request.
- A repair round adds only what its blocking finding needs. A finding that asks for code no acceptance criterion names is a known limit.
- The copy scan lives in the codebase-design skill, and dunify and the cut pass point at it.

This amends two rules of ADR 0011. Its first rule now excludes a cut. Its fourth rule keeps one simplify-and-reduce pass per pull request, but `publish-pr.ts` writes the pull request's size line from `diff-size`, in place of a shortstat the author types before and after the pass. The reason behind ADR 0011 still holds. Agents loop on findings, so a cut never holds up the slice it was found in and never becomes a ticket. It waits for a pass whose whole task is subtraction.

## Considered options

- **Block a slice on a cut.** Rejected. It brings back the loop ADR 0011 removed, and a verdict on one head cannot see a copy that spans two slices.
- **A depth review lane on every pull request.** Rejected. The audit lanes already report cuts, and a lane on one head still sees one slice.
- **A line cap per pull request.** Rejected. A cap invites gaming. The cut pass and the human read the size line.
- **A ticket per cut.** Rejected, for the reason ADR 0011 rejects a ticket per finding.

## Consequences

- A run of three or more slices starts one more owner per wave.
- A cut pass touches only the files its wave changed, plus the one home a copy moves to, so it stays a subtraction and never a repo-wide refactor.
- `code-simplification` uses deletion first, and readability decides between two forms of the same size.
