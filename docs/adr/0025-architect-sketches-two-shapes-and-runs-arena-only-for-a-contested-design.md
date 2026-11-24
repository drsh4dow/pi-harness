---
status: proposed
---

# architect sketches two shapes and runs arena only for a large or contested design

ADR 0018 rejected re-syncing `architect` with pstack's upstream, because ours grounds on the glossary and the ADRs and upstream's does not. Our `architect` then ran five phases and always ran `arena` in its sketch phase. Each run started four runners, one per panel model plus one on `divergent`, and a cross-judge, even for a shape one agent could sketch twice. ADR 0020 limited `arena` in the feature playbook to a contested shape that is costly to undo, but left the arena inside `architect`.

pstack 0.15.48 (cursor/plugins 2f87c85) cut `architect` to two paragraphs. It traces every system the change touches, sketches two shapes, and picks the one where each piece of state has one owner, each task has one way to do it, and callers need to know least. It redesigns when workarounds repeat, and a large or contested design runs `arena` instead. The human chose to adopt it in the pstack 0.15.48 sync.

So `architect` takes upstream's text and keeps three local rules:

- It reads the glossary entries and the ADRs that cover the area before it traces, and names the shapes in the glossary's terms (ADR 0018).
- It runs for a one-way-door shape or when a task asks for it, and the implementer builds a smaller shape when the code shows one and says what the sketch got wrong (ADR 0020).
- A shape handed to an owner is a file with a `## Synthesis decision` section, because the `delegate` tool refuses a `design` sketch without one.

The five phases, the runner prompt, the red-flag list and the rationale template go. The opt-in checkpoint goes too, because ADR 0018 already honors a stop the human asks for.

This amends ADR 0018's rejected option "Re-syncing architect with pstack's upstream" and its line that architect's checkpoint stays opt-in.

## Considered options

- **Keep the five phases and the mandatory arena.** Rejected. The glossary and ADR grounding that justified the fork fits in one sentence of the short text, and the arena then runs only where ADR 0020 already wants one.
- **Take upstream's text verbatim.** Rejected. It drops the glossary and ADR grounding, the one-way-door trigger, and the sketch file the `delegate` tool checks.

## Consequences

- `architect` starts no delegates unless the design is large or contested.
- The Refactoring, Bug fix and figure-it-out texts name `architect` for the shape and no longer promise parallel design exploration.
