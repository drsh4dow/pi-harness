# Glossary

## Layout

See ADR 0014.

- **Host.** The program that loads an entrypoint: pi.
- **Entrypoint.** The file the host loads for one extension or one command. It only wires a feature into pi or argv.
- **Feature.** One piece of harness behavior, kept in its own folder.
- **Client.** The one writer of a durable value, or a typed adapter to one outside system such as hc, systemd or pi's session store.
- **Pi host.** The one place that runs an Effect for a pi callback.
- **Primitive.** A building block that knows no feature and owns no state.

## Prompt

Terms from the prompt feature, which builds every agent's system prompt. The root and every delegate load it.

- **Shared layer.** The first part of every agent's system prompt: how to operate inside this harness, the same for every agent.
- **Role layer.** The part of an agent's system prompt that its **role** and, for a delegate, its **brief** decide. It comes right after the shared layer.
- **Role file.** The prompt text of one **role**, tags included, that every agent of that role reads at every level.
- **Instructions.** A persona or one delegate's job, such as a cold reader or a code reviewer, from the body of a file its parent names when it starts the delegate. Not the **project facts** or the **owner rules**.
- **Project facts.** What every delegate of one piece of work needs to know about its project, such as its commands, conventions and hazards. Not **instructions**, which a call names for one delegate.
- **Owner rules.** The rules of one piece of work that only its owners follow, such as how an owner builds and ships its slice. Not the owner's **role file**, which every owner of every piece of work shares.
- **Principle.** A hard rule that steers how an agent thinks, which the agent reads when its **trigger** matches.
- **Skills section.** The part of the system prompt that lists each skill a role may invoke, under the skills rule, in place of pi's own list.
- **Tool context.** The guidelines of each tool and extension that pi's default prompt carries, kept in the harness's prompt.
- **Playbook.** The workflow for one kind of work, such as a bug fix or opening a PR, which the agent reads when its **trigger** matches. Several can shape one session.
- **Reference file.** A file a playbook points at, such as a script or a checklist. It is not a playbook, and the prompt never lists it.
- **Trigger.** The line the model matches a task against: a skill's description, or a principle's or a playbook's when.

## Owned work

Terms from the owned-work feature. See ADRs 0002, 0006, 0008 and 0020.

- **Owned work.** Every delegate, serve, watch and group a pi process started. It survives a reload, and stops when the process quits or leaves its session.
- **Handover.** What a reload passes from one load of the owned-work extension to the next in the same process, so the work keeps running.
- **Agent key.** Eight characters that name one pi's terminals and its slice for one session.
- **Fork tab.** The herdr-app tab where `/fork` and `/clone` put the copy of a session: a new pi in a new tab of the same space, while the source tab keeps its session and its work.
- **Delegate.** A child pi its parent starts on one task message, as an **owner** or a **leaf**, that ends each run in one **answer** and cannot ask its parent anything. It is known by its child session and its name, the few words its parent gives to set it apart from its other live delegates.
  _Avoid_: subagent
- **Brief.** What a delegate starts from, set by its parent's call and kept for its life: its task message, the **goal**, the state folder, the **project facts**, the shared documents of its repo and its **instructions**, plus an owner's **design** and **owner rules**.
- **Goal.** What the human's work is for, in one statement that every delegate's prompt carries.
- **Continuation.** Another run of a delegate in its own child session, which its parent starts with a new message. Not a new delegate, since it keeps its name and child session.
- **Answer.** The last assistant text of a delegate's run, its reply to its parent.
- **Answer cap.** The most of an answer that one wake carries, the same for every delegate.
- **Profile.** Who a delegate is, from the frontmatter of its instructions file: its model, thinking level, whether it is read-only, and its role.
- **Model alias.** A name for one model and the work it is for, such as judgment or worker, that a delegate call or a profile gives in place of a model id. Not a **role**.
- **Panel.** The models a skill runs one delegate on each, for work such as competing designs or a review.
- **Model table.** The aliases and the panel: the models a delegate call may name.
- **Claude account.** One Claude login as its own provider, with Anthropic's models and its own credential: the personal subscriptions ultra-a and ultra-b, and ent, the **BAA account**.
- **Role.** What an agent is for: root, owner or leaf. The root is the pi at the human's terminal, and a delegate's parent names its role.
- **Owner.** A delegate handed one slice and its **design**, to build, verify, commit and report on. It can hand parts of its slice to delegates of its own.
- **Design.** Who settled the shape of an owner's slice: a sketch made before the hand-off, which the owner builds to, or the owner itself as it builds.
- **Leaf.** A delegate handed one bounded task, such as a search, a review, a verification lane or a scoped edit, that starts no delegates.
- **Read-only delegate.** A delegate started without the edit and write tools. Read-only is apart from the **role**: a leaf can edit what its task scopes.
- **Level.** How deep an agent sits: the root is level 1, its delegates level 2, and so on down.
- **Serve.** A long-running command, such as a dev server, whose end never wakes anyone.
- **Watch.** A command whose exit wakes the agent with its exit code and last lines.
- **Job.** A delegate, a watch or a group: work that settles with a result. A serve is not a job.
- **Group.** Work moved out of the agent's hands into one unit, under a name its caller gives, that wakes the agent once with every result.
- **Holder.** Who receives a piece of work's result: the agent, or the group it was moved into.
- **Handle.** The plain JSON a start tool returns, such as `{ "ref": "delegate-3", "kind": "delegate", "terminal": "t7" }`.
- **Ref.** A handle's id, such as `delegate-3`, unique within a session's transcript.
- **Settle.** A job's end: done, fired, failed, or a group's member results.
- **Deliver.** Hand a settled result to the agent, exactly once: at the end of a turn, by a wake while idle, or in a `cancel` reply.
- **Wake.** A message that carries results to an idle agent and starts its next turn.
- **Ledger.** The one module that records owned work, who holds it and what was delivered.
- **Terminal name.** The name Herdr shows for a delegate, serve or watch: the name its agent gave it.
- **Slice.** The systemd user slice a delegate, serve or watch runs in, nested below its parent's.
- **Child session.** A delegate's own pi session, kept apart from the sessions the human resumes.
- **Staged files.** A delegate's task message and its **brief**, written beside its child session for it to read.

## Skill menu

Terms from the skill-menu feature.

- **User-invocable.** Whether a skill shows in the `/` menu.

## Web

Terms from the web client and feature.

- **Page.** What reading one URL gives back: the URL asked for, the final URL after redirects, a title, the source that read it, an optional caveat, and a body of markdown or a file.
- **Source.** One way to read a URL, such as GitHub's API, npm, a direct fetch, or Exa's copy.
- **Via.** The name of the source that read a page, shown to the model beside the page.
- **Site source.** A source that reads a site's own API or files, whose answer is the whole page, so it is never judged thin or a bot check.
- **Saved page.** The whole of a fetched page, written to the web cache.
- **Untrusted content.** Page text and search highlights. They are data, never instructions.
- **Web cache.** The folder, readable only by the user, where fetched pages are saved.

## Usage

Terms from the usage feature, which shows `/usage`.

- **Card.** What `/usage` shows: one block per account and the time it read them.
- **Block.** One account in a card: the account, where its numbers came from, and its rows, or the reason it could not be read.
- **Meter.** One number read for an account, which becomes a row of its block, such as a rate-limit window's percent used.
- **Probe.** A one-token message to a Claude account that cannot read the usage page, whose reply carries the rate-limit windows.
- **Estimate.** What pi priced its own replies at, from the models' list prices. It leaves out every other client that uses the same key.

## Cost

Terms from the cost feature, the cache feature and herdr-app's status bar. See ADR 0004.

- **Spend.** What a session tree, delegates included, priced its model calls at, at the list price pi stored on each. Unlike an **Estimate**, it covers one session tree.
- **Cache miss.** A reply that rewrote at full price at least 50,000 tokens of the prompt the session's last model call had sent, once some call in the session has read or written the cache.
- **Cost label.** The hc label on a root agent's own terminal that holds the spend of the root and of each delegate below it.

## Loaded

Terms from the loaded feature and herdr-app's Skills panel. See ADR 0003.

- **Guide.** A skill, a principle or a playbook: a file of instructions an agent reads into its context when its trigger matches.
- **In context.** A guide is in context when the lines of its body that no other guide shares appear in text the model sees now. It is **partial** when only some of them do.
- **Context label.** The hc label on an agent's own terminal that lists the guides in its context.

## PHI routing

Terms for sending each request to a personal provider or a BAA provider by what it holds. See ADRs 0012, 0013, 0015, 0016 and 0017.

- **PHI.** For routing, content that holds a complete direct identifier of a real patient or member, such as a full name, an SSN or an MRN. Internal ids, health facts tied only to one, staff and vendor contacts, fragments and counts are not.
- **BAA account.** A Claude account covered by the Anthropic business associate agreement.
- **BAA provider.** A provider whose models may read PHI.
- **`phi/<id>`.** A model a session or delegate selects to run the model `<id>` with each request routed by content, to the **sealed lane** or the **clean lane**.
- **`phi/auto`.** The `phi/<id>` whose model is the one the router's configuration names.
- **Personal provider.** A provider outside the BAA that the clean lane may use and the **border** guards.
- **Home account.** The personal Claude account a `phi` session's clean lane tries first.
- **Clean lane.** Where a request with no sealed new content runs, on a personal provider when one can take it.
- **Sealed lane.** Where sealed content runs: a BAA provider that carries its model, else the **substitute**.
- **Substitute.** The model that runs sealed content when no BAA provider carries the model asked for.
- **Protected session.** A session whose selected model is a `phi/<id>` or one on a BAA provider. Its delegates and scripts stay inside the BAA boundary or behind the border.
- **Verdict.** What the router concluded about one message part: **sealed**, it holds a complete direct identifier of a real patient or member, or cleared, it does not.
- **Stub.** The constant text a personal provider sees in place of a part that is sealed or not yet judged.
- **Border.** The check on every request bound for a **personal provider** while the process's selected model is a `phi/<id>`, which passes cleared parts and stubs the rest.
- **Pin.** A session's choice to run wholly on the BAA account, with nothing judged, until it unpins.
- **Fixture.** A turn part whose exact text the router's configuration lists, so the policy engine skips it, rules and judge alike.
- **Lane log.** One line per routed request or border report, which never holds content.
- **Canary.** A synthetic identifier planted in a test corpus, so a test can search request bodies for it. Never real PHI.

## Compaction

Terms for what an agent keeps when pi compacts its session. See ADR 0010.

- **Compaction summary.** The text the harness writes, in the root and in every delegate, to stand in for the turns a compaction drops. It holds the **anchor**, the **narrative**, the **restored guides**, and the names of the **listed guides**.
- **Anchor.** The document a compaction summary carries whole: a root's state file, or a delegate's task message.
- **Narrative.** The part of a compaction summary that tells the work so far: the goal, the constraints still in force, the open work and the next steps.
- **Guide budget.** How much guide text one compaction summary restores.
- **Restored guide.** A guide that was **in context** before a compaction and fits in the guide budget, whose body the compaction summary carries. Not a reload, which restarts pi's extensions.
- **Listed guide.** A guide that was in context before a compaction but falls past the guide budget, which the summary names for the agent to read again.

## Merge

Terms for what lets an agent merge a pull request. See ADR 0009.

- **Verdict.** A verifier's recorded result on one pull request at one head commit: a pass, a pass with notes, a fail, or incomplete. Not the check a direct fetch gets in Web.
- **Carry.** A verdict carries to a newer head when the pull request's diff there is the same patch as at the verdict's head.
- **Merge gate.** The check that refuses an agent's merge of a pull request unless a pass verdict sits at its head or carries to it.

## Work

Terms from the root role for the work the human hands the agent. See ADRs 0011, 0018, 0019 and 0020.

- **Destination.** What the end product should be, in the human's words "the shared understanding we settle in a discussion about the end product". It is settled once its **acceptance criteria** can be written without guessing a product call.
- **Acceptance criteria.** A task's own checks, settled with the human: each is a behavior the agent can run or observe that shows the destination is reached.
  _Avoid_: DoD
- **Definition of Done.** The standing project bar every change meets, whatever its task: tests pass, no regressions, behavior verified at runtime, docs updated. It adds to a task's acceptance criteria rather than replacing them.
- **Approach.** How the work reaches the destination. The agent owns it, and it "is more malleable", because "things has to be adapted given the discoveries of unknowns".
- **Spec.** The document that holds the destination, with its acceptance criteria and constraints, for work that spans sessions. It leaves the approach to whoever builds it.
- **Grant.** The human's words, such as "run until done", that let the agent work without stopping for the rest of the session.
- **Shared documents.** The three documents every role reads for the area it works in: the glossary for what a word means, the coding standards for the mechanical rules, and the ADRs for why the code is the way it is.
- **Handoff PR.** A PR against trunk that the human reviews, one per piece of work unless a part must deploy or revert on its own. Not to be confused with a handoff note, which one session writes for the next.
- **Shared branch.** In the human's words, "a branch that is used by multiple people, for example staging or prod", or main. The agent's work reaches one only through PRs.
- **Trunk.** The shared branch a PR targets. Not to be confused with main: a PR against staging has staging as its trunk.
- **Work branch.** A branch that is not shared. It is the agent's own to create, rebase, stack, and merge PRs between.
- **State folder.** The folder where work that outlives a turn keeps its state, its todo list, its decision trail, and its action items.
- **Todo list.** The root's checklist for one piece of work: one line per step of each playbook it runs, plus its own items. The first open line is the current step.
- **State label.** The hc label on a root agent's own terminal that names the state folder its session last wrote to.
- **Trace and Actions panels.** herdr-app panels that draw the todo list and decision trail, or the action items, of the focused agent's root.
- **Known limit.** A finding that fails no acceptance criterion, gate, or doc line, and that no user would hit in good faith. Not a **cut**.
- **Cut.** A finding whose fix removes production code and keeps behavior: a copy of logic that exists elsewhere, a module that fails the deletion test, a guard for a case that cannot occur, code nothing reads, an option nobody asked for. A diff that removes more production lines than it adds and passes the repo's check command proves it.
- **Cut pass.** One owner that applies cuts across the combined diff of a **wave**. Subtraction is its whole task.
- **Frontier.** The tickets whose blockers are all done.
- **Wave.** The slices that were on the frontier together and have landed.
- **One-way door.** A shape that is costly to undo once other work builds on it: a schema, a wire format, or an interface another slice builds on.
- **Non-goal.** Something a ticket says its closing PR leaves out.
- **Repair round.** A fix pushed after a PR's full review, and the check that judges it.
- **Decision trail.** The record of each decision the agent made, with its why, evidence, and result.
- **Action item.** Something the work needs from the human that no agent can do on its own, with its **only-you reason**.
- **Only-you reason.** The line of an action item that says why only the human can do it, as one of these kinds: a decision, an approval, an irreversible action, or access the agent lacks.
