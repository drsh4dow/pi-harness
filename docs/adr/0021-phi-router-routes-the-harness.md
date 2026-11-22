---
status: proposed
supersedes: 0013, 0016, 0017
---

# phi-router routes the harness, and owned-work maps an alias to a phi model or a pin

The harness ran its own PHI router in process: the policy, the judge, the verdict cache, the border, the lane log and the eval corpus, under `src/features/phi-router/`. [phi-router](https://github.com/drsh4dow/phi-router) now does the same work as one local service for pi, Claude Code and Codex, and its pi package adds the provider `phi`. Two copies of the routing would drift, and only one of them is tested against every harness. So the harness uses phi-router and keeps only what phi-router cannot see.

## Decision

- **Install.** The human runs `pi install <phi-router checkout>`. The package registers `phi/auto`, `phi/sealed` and `phi/<id>` for each Anthropic model of pi's catalog, starts the router with each session, and answers `/phi`. The harness holds no routing code.
- **Accounts.** The four accounts are phi-router's lists, in `config.json` under the XDG config folder. `src/features/phi/phi-router.config.json` is the human's file. `ultra-a` is a login folder, `ultra-b` is a key command over its setup-token, `ent` is the login folder `~/.claude` and lacks `claude-fable-5-2`, and `openai` is a BAA account by API key. phi-router needs an open account for each vendor that has a BAA account, so the Codex login is the open OpenAI account. The harness's `ultra-a` and `ultra-b` providers stay for a session the human runs on them directly. phi-router reads its own logins, because the pi package forwards only pi's `anthropic` login, which is none of the four.
- **Failover.** phi-router moves a `phi` session's request to the other open account on a 429. The harness's `claude-accounts` failover stays for a session on a raw Claude account.
- **Delegates.** A delegate of a protected session keeps the model its alias or call names. When phi-router carries the id, the delegate runs `phi/<id>`, so the router picks the account per request. When a BAA provider carries it, the delegate runs on that provider as named, as `investigator` runs on `openai`. Otherwise it runs `phi/sealed`, and its tool result says which model was substituted. A held parent, one on a BAA provider or `phi/sealed` or one phi-router reports pinned, has its delegate's session pinned with `phi-router pin --session` before the delegate starts. phi-router itself pins a delegate whose folder is in a BAA repo.
- **Children load the package.** owned-work starts each delegate with the extension file that registered `/phi`, so a delegate has the `phi` models and the same router.
- **Codemode.** A codemode script in a protected session may not call `models`, since those calls go to their own provider and bypass phi-router. The guard is the one routing rule left in the harness, in `src/features/phi/`.
- **A switch away breaks the seal.** A session the human moves to a model that is not a `phi` model sends its whole conversation to that model's provider. phi-router never sees the request. This keeps the ruling of ADR 0017.

## Considered options

- **Keep the in-process router and share phi-router's policy.** Rejected. The border, the verdict store and the lane log would still be two copies.
- **Register `phi/<id>` for the model table in the harness.** Rejected. pi keeps one registration of a provider, the package's loads last, and copying its wire couples the harness to the package's private headers.
- **Forward the harness's Claude logins through the package.** Rejected for now. The package forwards pi's `anthropic` login only, so it would need a change in phi-router.

## Consequences

- ADR 0015 stands. The human still picks the model of a protected session.
- `divergent` from a protected parent runs on `phi/sealed`, since its model is on no Anthropic or BAA account.
- A delegate started outside a BAA repo by a parent inside one is not held. phi-router judges where the delegate's lease folder is.
- The scenarios in `src/features/phi/` run the real pi and phi-router against loopback mocks, in a network namespace, through `offline.sh`.
- The eval corpus and its wire scenarios moved to phi-router. ADR 0014's line about the corpus folder no longer has a folder.
