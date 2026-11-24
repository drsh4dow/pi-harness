---
when: "New or changed behavior, built from a named data shape: add or change a feature, an option, a command, or a setting, implement a ticket, or make any other change to what code does."
---

### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Name the acceptance criteria you build to, from the ticket, the spec, `STATE.md`, or the task message. When you cannot write them without guessing a product call, a root runs `playbooks/align.md` first, and a delegate stops and reports what is missing.
2. Trace the affected subsystem.
3. When your brief names no sketch, run `architect` for a one-way-door shape (a schema, a wire format, or an interface another slice builds on) or when your task asks for it. Settle any other shape as you build.
4. Write the throughput checkpoint as four items in your reply. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (**principle-separate-before-serializing-shared-state**). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
5. Hand code-writing to a delegate with the named data shape and its organizing structure per **principle-model-the-domain** (a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions), chosen before the delegate writes logic, and the acceptance criteria. Pick each delegate's model alias and role for the job. Delegate via the **arena** skill instead only for a contested shape that is costly to undo. No "standing by" reply that waits on a nested agent. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally. The step is done when each delegate's work is committed on your branch.
6. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
7. Run one pass of `playbooks/code-simplification.md` over the whole diff that deletes what no acceptance criterion needs, and commit it. Then rebase into small, ordered commits.
   Use **principle-sequence-verifiable-units**, building, verifying, and committing each small unit before the next.
8. If the design is contested, `interrogate` before shipping.
9. Run **Opening a PR**.

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
