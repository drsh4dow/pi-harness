---
status: accepted
---

# The codemode guard covers only a session on a phi model

ADR 0021 kept one routing rule in the harness: a codemode script in a protected session may not call `models`. A protected session then meant a session on a `phi` model or a BAA provider, so the guard blocked scripts in every `openai` session, where `investigator` runs, even in a repo with no patient data. In five days it blocked 104 scripts, all in `openai/gpt-6.1-sol` sessions and none in `phi` sessions. The sampled blocks named `models` only inside strings such as `models.py`. The human ruled that a session is protected when it runs on a `phi` model, and only then.

So the guard checks for a `phi` model alone, and a protected session is a session on a `phi` model. This amends the codemode bullet of ADR 0021. Its delegate rules stand: a session on a BAA provider is still a held parent, and its delegates stay inside the BAA boundary.

## Considered options

- **Keep BAA providers guarded and stop matching names inside strings.** Rejected. The human kept the pattern as it is and narrowed who it covers.

## Consequences

- A codemode script in a session on a BAA provider may call `models`, and those calls go to their own providers, outside phi-router.
- The pattern stays a name match. On a `phi` model, a script can still reach `models` through `(async()=>{}).constructor("return "+"mod"+"els")()` or through `this` in sloppy mode. The human kept that limit.
