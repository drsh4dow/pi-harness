---
when: Work that spans phases or stacked PRs, or asked to plan it before building ("plan first", "break this into PRs").
for: [root]
---

### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist an owner runs box by box and the operator audits from the evidence.** The plan is the deliverable. Do not implement.

1. Name the acceptance criteria the plan builds to, from the ticket, the spec, `STATE.md`, or the task message. When you cannot write them without guessing a product call, run `playbooks/align.md` first.
2. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
3. Settle open questions by prototype before you write, per `playbooks/prototype.md`. Ask the operator only about a product or preference call that no run can settle.
4. When the work spans sessions, write its destination with the **to-spec** skill, then break it into tickets with the **to-tickets** skill. One ticket is one owner's slice. Its acceptance criteria go into that owner's task message, and they are what the owner's verification lanes check.
5. Write the plan file, under `docs/` in the state folder unless the operator names a path. Open with what changes, the PR ids in landing order, and the dependency graph, which says which PRs are independent and branch from trunk, which wait for which, and the paths each may touch. Then one section per PR. One PR is one change with its own evidence (**principle-sequence-verifiable-units**). PRs against a shared branch stay few, self-contained, and easy to review. Each section has checkboxes for what it depends on, what the user sees, and its verification. Leave the files to edit and the symbols to build to the PR's owner, who settles the shape.
6. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. The unit box runs the repo's full test suite once per pushed head and only the affected tests in fix rounds. When CI runs the same command, CI is the gate. Each live box drives the real surface through the project's verification skill, or the **agent-browser** skill for a browser surface with none, with a concrete scenario and a pass predicate. The perf box names the metric, the probe, the trunk baseline measured first, and the number that fails. A PR that changes an interaction waits for the operator's review before merge.
7. Hand back the plan path and stop. Execution starts on the operator's explicit go.

**Reply:** the plan path, the PR ids with their dependencies and the review-gated set, and what stays unproven.
