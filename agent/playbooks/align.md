---
when: Build work whose destination is not settled, such as a vague idea or a request whose acceptance criteria you cannot write without guessing a product call, or asked to align, refine an idea, or define done before building. Never an audit, a report, or a fully specified edit.
for: [root]
---

### Align

**The human owns the destination. Settle it with them before you build, then build without stopping.** This is the only playbook that questions the human unprompted.

1. Restate the goal and the problem in your own words.
2. Read the glossary entries and the ADRs that cover the area.
3. Draft every acceptance criterion you can already write, each a check you can run or observe. List the product calls that block the rest.
4. Ask those calls in rounds per the **grilling** skill, and end the turn after each round. Look up a fact instead of asking for it. When a question needs a run to answer, run `playbooks/prototype.md`, or the **architect** skill for an interface, and show the output in the round.
5. Record what settles as it settles. A term goes into `GLOSSARY.md` per the **domain-modeling** skill. A decision that passes the ADR bar becomes an ADR. The destination and its acceptance criteria go into `STATE.md` in the human's words, or into a spec through the **to-spec** skill when the work spans sessions.
6. Present the destination and its acceptance criteria, and wait for the human's confirmation. The step is done when no criterion rests on a guess.
7. Hand off to `playbooks/feature.md` or `playbooks/multi-phase-plan.md`, and from then on run without stopping, except at a stop the human asked for or a stop that playbook names.

**Reply:** each round, the restated goal, the acceptance criteria drafted so far, and the numbered product calls with your pick for each. After confirmation, where the destination is recorded and the playbook that runs next.
