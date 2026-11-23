---
when: Reviewing or verifying a change, holding a finding someone reported, or about to handle an edge case no acceptance criterion names.
---

# Triage Findings

A program always has more edge cases than anyone will handle, and each fix adds code with edge cases of its own. Handle the cases a user reaches.

## A finding counts when it carries its line

A finding counts when you can write one of these lines beside it:

- **Fails.** The acceptance criterion, gate, or doc line it fails.
- **Path.** Who the user is, what they do through the real entry point (a command, a click, an API call), and what they then see or lose. The user acts in good faith and uses the product for its purpose. Ordinary mistakes count, and contrived input does not.
- **Harm.** What cannot be undone once it happens: stored data lost or corrupted, a secret or access leaked, money moved. Name the events that cause it in the code as it stands. Harm counts however rare it is.

A missing test counts when the behavior it would guard counts. Any other finding is a **known limit**.

Write the line before you report a finding, and before you add a guard or a branch for a case. Whoever reports a finding writes its line, so a finding that reaches you without one is a known limit until someone writes it.

## What a finding gets

- **A finding that counts** gets a fix. Only it fails a verdict or holds work up.
- **A known limit** gets one line, in the review and in the PR. It gets no fix, and no ticket unless it breaks the spec or the human asks for one.
- **A cut** is a finding whose fix removes more production code than it adds and keeps behavior, such as a copy of logic that lives elsewhere, a module that fails the deletion test, or code nothing reads. A cut is never a known limit, never holds a slice up, and gets no ticket. A reviewer lists each cut in its verdict, and the root hands it to the next **cut pass**, which applies it. Work of fewer than three slices hands its cuts to the simplification pass that `playbooks/feature.md` runs over the whole diff before the PR.

## Fix by removing the case

When a finding counts, take the first fix that works:

1. Remove the path, so the case cannot occur.
2. Reject the input at the boundary.
3. Handle the case.

A fix adds only what its finding needs.
