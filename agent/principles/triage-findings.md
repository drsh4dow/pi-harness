---
when: A finding in hand, from a review, a drive, a bot, or your own check, to fix, block on, ticket, or list in a verdict.
---

# Triage Findings

A finding that fails no acceptance criterion, gate, or doc line, and that no user would hit in good faith, is a **known limit**. It gets one line in the PR and never holds the work up. It gets no fix, and no ticket unless it breaks the spec or the human asks for one.

A **cut** is a finding whose fix removes more production code than it adds and keeps behavior, such as a copy of logic that lives elsewhere, a module that fails the deletion test, or code nothing reads. A cut is never a known limit, never holds a slice up, and gets no ticket. A reviewer lists each cut in its verdict, and the root hands it to the next **cut pass**, which applies it. Work of fewer than three slices hands its cuts to the simplification pass that `playbooks/feature.md` runs over the whole diff before the PR.
