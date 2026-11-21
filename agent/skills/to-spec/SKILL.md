---
name: to-spec
description: "Write a settled destination as a spec, with its acceptance criteria, for work that spans sessions, or asked for a spec or a PRD: synthesis of what was already settled, no interview."
for: [root]
---

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/skill:setup-matt-pocock-skills`.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

3. Write the spec using the template below, and keep it in the work's state folder. Publish it to the project issue tracker per your role's publishing rule, with the `ready-for-agent` triage label - no need for additional triage.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## Acceptance Criteria

The checks that show the destination is reached. Each is one behavior and how to run or observe it, in the user's words where they gave them.

## Constraints

Only what binds whoever builds it:

- One-way doors: a schema, a wire format, a public contract, an ADR.
- Choices the human made, in their words.
- The seam the acceptance criteria are checked at, from step 2.

The rest of the approach is the implementer's.

## Out of Scope

A description of the things that are out of scope for this spec.

</spec-template>
