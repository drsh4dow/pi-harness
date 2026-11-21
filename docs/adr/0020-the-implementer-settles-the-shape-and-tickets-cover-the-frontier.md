---
status: proposed
---

# The implementer settles the shape, and tickets cover only the frontier

The shape of a slice was decided four times before its owner wrote a line. The spec listed the modules and interfaces to build, the plan named the symbol and the file of each change, the delegate tool refused an owner without a design, and `design: yours` told the owner to run `architect`, which runs an arena of four runners. The feature playbook then required a second arena for any slice with more than one valid shape. An owner that found a smaller shape in the code could only report it, since its role told it to follow the approach it was handed. The tickets fixed the rest up front. In one run, a single blocking edge behind a ticket with a false premise held 12 tickets for about 10 hours. No ADR recorded the design requirement or the mandatory arena. They came with the upstream playbooks and the owned-work brief.

So the implementer owns the how, and the root plans only as far as it can see:

- A spec holds the destination, its acceptance criteria, its constraints and what is out of scope. Its constraints are one-way doors, choices the human made, and the seam the acceptance criteria are checked at.
- `design` keeps its two values. An owner builds to a sketch, but where the code shows a smaller shape that meets the same acceptance criteria, it builds that and says what the sketch got wrong. `yours` leaves the shape to the owner, which runs `architect` first for a one-way-door shape (a schema, a wire format, or an interface another slice builds on) or when its task asks for it.
- The feature playbook runs `arena` only for a contested shape that is costly to undo. A plan names each pull request's behavior, evidence and blocking edges, not its files and symbols.
- An owner handed an approach with a clear problem takes one that meets the acceptance criteria and reports what it did. A change to an acceptance criterion, a constraint, or a seam another slice builds on stays its parent's call.
- `to-tickets` drafts the tracer bullet and only the tickets whose acceptance criteria can be written without guessing how an earlier slice turns out. The rest waits as a Later list until the wave before it lands. A blocking edge exists only where a ticket uses an interface another creates, and a criterion that rests on an unobserved fact gets a spike first.

This amends ADR 0008's paragraph on an owner at the last level handed its design. That owner now settles the shape as it builds, and runs `architect` and `arena` with leaves at level 4 only for a one-way-door or contested shape, or when its task asks for them.

## Considered options

- **A third `design` value for mechanical slices.** Rejected. `yours` with a one-way-door trigger gives the same exit with one fewer value.
- **Keep the mandatory arena for review separation.** Rejected. The verdict swarm already reviews every pull request with agents that did not write it, so a second bakeoff over one design costs runners and buys no new reader.
- **Let an owner rewrite its acceptance criteria.** Rejected. The destination stays the human's, per ADR 0018, so the owner stops and reports such a change.

## Consequences

- An owner may ship a shape nobody sketched. The verdict swarm and the cut pass are its second readers.
- The plan template has no Files or Build block, so the plan check script stops requiring them.
