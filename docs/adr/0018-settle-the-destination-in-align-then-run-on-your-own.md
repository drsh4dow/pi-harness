---
status: accepted
---

# Settle the destination in align, then run on your own

The harness carried two families, ported from two upstreams, that never named each other. The alignment skills (grilling, domain-modeling, to-spec, to-tickets) interview the human until both agree. The build skills and playbooks (architect, interrogate, prototype, feature) decide alone. The root role took the build family's default, "Don't wait for confirmation", so a vague build request started at once and the agent's guess became the destination. The alignment skills ran only when the human typed their names, and the build skills never read what they wrote.

So the harness runs one contract. The human owns the destination and the agent owns the approach. The agent does not run on its own until it can write the work's acceptance criteria, checks it can run or observe, without guessing a product call. Until then the root runs the `align` playbook, the only place it questions the human unprompted. Once they are settled it runs to done without stopping, except at a stop the human asked for or one the next playbook names, such as the go a plan waits for. An audit, a report or a fully specified edit needs no alignment. At the start of a task the gate holds even under a grant. Mid-run under a grant, the agent applies its pick for a product call and logs it. Every role works in the language of three shared documents: `GLOSSARY.md` for what a word means, `CODING_STANDARDS.md` for the mechanical rules, and `docs/adr/` for the why. The root, with the human, settles what a term means, and a delegate edits the glossary only when its task says to.

## Considered options

- **A router skill that sends work to alignment or to building.** Rejected. A skill is in context only after the model chooses it, while the playbook index is always in the prompt (ADR 0005). `align` is a playbook so it routes by kind of work, beside feature and bug fix.
- **A human checkpoint in architect by default.** Rejected. The checkpoint belongs before the destination is settled, not after the design. architect's checkpoint stays opt-in.
- **Re-syncing architect with pstack's upstream.** Rejected. architect now grounds on the glossary and the ADRs and names types with glossary terms, which the upstream skill does not. architect no longer tracks pstack's upstream.

## Consequences

- `idea-refine` and `grill-with-docs` are gone. `grilling` loads `domain-modeling` inside a repo and shows in the skill menu.
- `to-spec` and `to-tickets` are model-visible for the root. One ticket is one owner's slice, and its acceptance criteria go into the owner's task message.
- "Acceptance criteria" are a task's own checks, and "Definition of Done" stays the standing project bar.
- `src/features/prompt/references.test.ts` fails when a prompt file routes the model to a hidden or missing skill, path or section.
