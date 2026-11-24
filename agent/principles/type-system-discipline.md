---
when: Designing types or a function signature, reviewing a signature, or writing code in any statically typed language.
---

# Type System Discipline

Make the compiler reject impossible states, mismatched primitives, and unhandled variants.

- **Make illegal states unrepresentable.** Shape the type so a value the domain forbids cannot be built, for example a discriminated union instead of a set of optional fields that must agree.
- **Brand semantic primitives.** If two arguments share a primitive type but mean different things, give each its own type. Validate once at creation.
- **External data is untyped until parsed.** JSON, RPC payloads, CLI args, config, environment variables, and database rows go through a parse function at the boundary that returns the typed model.
- **Exhaust variants.** Handle every case of a union so the compiler fails when a new variant appears and a branch does not cover it.
- **Derive types from authoritative schemas.** When a schema file owns a shape, derive the type from it instead of hand-rolling a parallel one.

For TypeScript syntax, see the **typescript-best-practices** skill.
