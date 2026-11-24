---
name: architect
description: Sketch types, signatures and module structure before code. Use for a one-way-door shape (a schema, a wire format, or an interface another slice builds on), or when asked to architect a change.
for: [root, owner]
---

# Architect

Before writing code, read the glossary entries and the ADRs that cover the area, then trace every system the change touches. Sketch two different shapes for it (types, signatures, module boundaries) in the glossary's terms, and pick the one where each piece of state has one owner, each task has one way to do it, and callers need to know least. Redesign instead of patching if workarounds repeat.

For a large or contested design, run the **arena** skill instead of sketching alone.

Build to the pick. Where the code shows a smaller shape that meets the same acceptance criteria, build that and say what the sketch got wrong. To hand the shape to an owner instead, write it to a file whose `## Synthesis decision` section names the pick and why it beat the other shape, and pass that path as the `delegate` tool's `design`.
