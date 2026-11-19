---
when: A throwaway sketch to make a design or behavioral decision cheaply, such as whether a state model or a layout feels right, or to settle an empirical fork by observing it instead of asking the human ("prototype", "mock it up", "try this layout", "sketch it to decide").
---

### Prototype

**You own the design decision, not the code. The prototype is a throwaway instrument. The real build follows Feature.**

The one playbook where the Laziness Protocol's "smallest change" and the verification bar invert. Speed over polish, code quality does not matter, no planning. The rigor is in picking the right design cheaply. Propose variations the user didn't ask for, throw an approach away and try another.

**Where it lives.** Outside the work branch. A standalone sketch goes in a scratch folder, built in the lightest stack that renders the idea. A prototype that must run inside the app goes on a throwaway branch in its own worktree. The work branch receives only the decision. What outlives the prototype is its answer: the question, the verdict, and the evidence (screenshots, the observed output), written into the ticket, the PR, or `STATE.md`. Remove its code, scratch folder, and throwaway branch when the work ends, unless the human asks to keep them.

**Who picks.** A run settles a fact, such as behavior, timing, or output. A look or a feel is the human's pick while the work is in `playbooks/align.md`. Otherwise you pick, and the reply says so.

1. Scope the decision the prototype exists to make: which layout, which interaction, which density, or for an empirical fork which behavior, timing, or approach. No decision means no prototype. Route to Feature.
2. Gather references when the design space is open. Search for prior art and summarize a moodboard of themes, palettes, and layouts. Skip when the direction is set.
3. For a logic, state-model or UI question, read the **prototyping** skill and build the prototype where it lives with it. For a behavioral or timing decision, write the smallest script that exercises the question. No tests, no abstractions.
4. When comparing alternatives, build them behind one switcher (buttons or a keypress), each variant labeled. This is **principle-exhaust-the-design-space** made cheap.
5. Verify on the matching surface. For a visual decision, screenshot each variant via the verification skill and drive the interaction. For a behavioral or timing decision, observe the thing you are deciding by logging the timing, printing the output, or watching the render. The observation is the test here, not an assertion.
6. Present alternatives, tradeoffs, and a recommendation, and settle the pick per **Who picks**. The output is the decision and its evidence, not shippable code. Hand the chosen direction to **Feature** (or `architect` for the shape) for the real build.

**Reply:** the variants explored, the evidence (screenshots for a visual decision, the observed output or timing for a behavioral one), tradeoffs, your recommendation, who picked, where the answer is written, and the scratch folder or throwaway branch until the work ends. Say plainly that the prototype is throwaway.
