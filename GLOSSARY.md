# Glossary

## Layout

See ADR 0014.

- **Host.** The program that loads an entrypoint: pi.
- **Entrypoint.** The file the host loads for one extension or one command. It only wires a feature into pi or argv.
- **Feature.** One piece of harness behavior, kept in its own folder.
- **Client.** The one writer of a durable value, or a typed adapter to one outside system such as hc, systemd or pi's session store.
- **Pi host.** The one place that runs an Effect for a pi callback.
- **Primitive.** A building block that knows no feature and owns no state.
- **Harness entry.** An `agent/` entry this checkout ships into an agent folder: one that a `!/agent/<entry>` line of `.gitignore` lets git track.
- **User agent folder.** The user's own pi agent folder, the one `getAgentDir()` names, which holds what the harness does not ship: credentials, settings and sessions.

## Prompt

Terms from the prompt feature, which builds every agent's system prompt. The root and every delegate load it.

- **Shared layer.** The first part of every agent's system prompt: how to operate inside this harness, the same for every agent.
- **Role layer.** The part of an agent's system prompt that its **role** and, for a delegate, its **brief** decide. It comes right after the shared layer.
- **Role file.** The prompt text of one **role**, its `<role>` and `<collaboration>` blocks, that every agent of that role reads at every level.
- **Instructions.** A persona or one delegate's job, such as a cold reader or a code reviewer, from the body of a file its parent names when it starts the delegate. Not the **project facts** or the **owner rules**.
- **Project facts.** What every delegate of one piece of work needs to know about its project, such as its commands, conventions and hazards. Not **instructions**, which a call names for one delegate.
- **Owner rules.** The rules of one piece of work that only its owners follow, such as how an owner builds and ships its slice. Not the owner's **role file**, which every owner of every piece of work shares.
- **Principle.** A hard rule that steers how an agent thinks, which the agent reads when its **trigger** matches.
- **Skills section.** The part of the system prompt that lists each skill a role may invoke, under the skills rule, in place of pi's own list.
- **Tool context.** The guidelines of each tool and extension that pi's default prompt carries, kept in the harness's prompt.
- **Playbook.** The workflow for one kind of work, such as a bug fix or opening a PR, which the agent reads when its **trigger** matches. Several can shape one session.
- **Self-contained skill.** A skill published on skills.sh, which runs in any agent with only its own folder, so no file in it reaches into the harness.
- **Reference file.** A file a playbook points at, such as a script or a checklist. It is not a playbook, and the prompt never lists it.
- **Trigger.** The line the model matches a task against: a skill's description, or a principle's or a playbook's when.

## Owned work

Terms from the owned-work feature. See ADRs 0002, 0006, 0008 and 0020.

- **Owned work.** Every delegate, serve, watch and group a pi process started. It survives a reload, and stops when the process quits or leaves its session.
- **Handover.** What a reload passes from one load of the owned-work extension to the next in the same process, so the work keeps running.
- **Inheritance.** What a session start takes from the load before it: nothing (fresh), the **handover**'s work to keep running (carried), or work laid out by other ledger code, which it stops (stale). Its agent key is the one the new load runs under.
- **Agent key.** Eight characters that name one pi's terminals and its slice for one session.
- **Herdr-App.** The window that shows the terminals hc runs, in spaces and tabs, and moves the person's typing to the terminal it focuses. It runs no terminal itself; hc does.
- **Fork tab.** The herdr-app tab where `/fork` and `/clone` put the copy of a session: a new pi in a new tab of the same space, while the source tab keeps its session and its work.
- **Delegate.** A child pi its parent starts on one task message, as an **owner** or a **leaf**, that ends each run in one **answer** and cannot ask its parent anything. It is known by its child session and its name, the few words its parent gives to set it apart from its other live delegates.
  _Avoid_: subagent
- **Brief.** What a delegate starts from, set by its parent's call and kept for its life: its task message, the **goal**, the state folder and its **destination file**, the **project facts**, the shared documents at the root of its repo and its **instructions**, plus an owner's **design** and **owner rules**.
- **Brief source.** A file or folder a **brief** is built from: an instructions file, a state-folder note, a design sketch, a repo's shared documents, or the folder a delegate starts or keeps its state in. Owned work reads them and never writes them.
- **Goal.** What the human's work is for, in one statement that every delegate's prompt carries.
- **Destination file.** The `STATE.md` in a work's state folder, which holds the work's **destination** and its **acceptance criteria**.
- **Continuation.** Another run of a delegate in its own child session, which its parent starts with a new message. Not a new delegate, since it keeps its name and child session.
- **Answer.** The last assistant text of a delegate's run, its reply to its parent.
- **Answer cap.** The most of an answer that one wake carries, the same for every delegate.
- **Profile.** Who a delegate is, from the frontmatter of its instructions file: its model, thinking level, whether it is read-only, and its role.
- **Model alias.** A name for one model and the work it is for, such as judgment or worker, that a delegate call or a profile gives in place of a model id. Not a **role**.
- **Panel.** The models a skill runs one delegate on each, for work such as competing designs or a review. Each seat is a **model alias** or a `provider/id`.
- **Model table.** The aliases and the panel: the models a delegate call may name.
- **Claude account.** One Claude login as its own provider, with Anthropic's models and its own credential: the personal subscriptions ultra-a and ultra-b, and ent, the **BAA account**.
- **Limited account.** A Claude account that answered 429, until the reset that reply names. A session that hits a 429 moves to an account that is not limited, or waits for the first one back.
- **Role.** What an agent is for: root, owner or leaf. The root is the pi at the human's terminal, and a delegate's parent names its role. A prompt file's frontmatter `for` lists the roles it fits.
- **Owner.** A delegate handed one slice and its **design**, to build, verify, commit and report on. It can hand parts of its slice to delegates of its own.
- **Design.** Who settled the shape of an owner's slice: a sketch made before the hand-off, which the owner builds to, or the owner itself as it builds.
- **Leaf.** A delegate handed one bounded task, such as a search, a review, a verification lane or a scoped edit, that starts no delegates.
- **Read-only delegate.** A delegate started without the edit and write tools. Read-only is apart from the **role**: a leaf can edit what its task scopes.
- **Level.** How deep an agent sits: the root is level 1, its delegates level 2, and so on down.
- **Serve.** A long-running command, such as a dev server, whose end never wakes anyone.
- **Watch.** A command whose exit wakes the agent with its exit code and last lines.
- **Watch log.** The file that holds a watch's full output, once its command has started.
- **Start time.** The local wall-clock time at which the ledger took a start request, which the pane's header shows.
- **Job.** A delegate, a watch or a group: work that settles with a result. A serve is not a job.
- **Group.** Work moved out of the agent's hands into one unit, under a name its caller gives, that wakes the agent once with every result.
- **Holder.** Who receives a piece of work's result: the agent, or the group it was moved into.
- **Handle.** The plain JSON a start tool returns, such as `{ "ref": "delegate-3", "kind": "delegate", "terminal": "t7" }`.
- **Ref.** A handle's id, such as `delegate-3`, unique within a session's transcript.
- **Settle.** A job's end: done, fired, failed, or a group's member results.
- **Cancel.** End live work before it settles on its own. The failure names the group whose settling ended a serve it held, and names no group when the agent's own `cancel` call ended the work.
- **Deliver.** Hand a settled result to the agent, exactly once: at the end of a turn, by a wake while idle, or in a `cancel` or `wait` reply.
- **Wake.** A message that carries results to an idle agent and starts its next turn.
- **Wait.** A tool call that keeps the agent's turn until a job it holds settles, then delivers the results due in its reply.
- **Wait scope.** The jobs one wait is for: those its call names, or every job the agent holds when it names none.
- **Ledger.** The one module that records owned work, who holds it and what was delivered.
- **Entry kind.** The `customType` a feature gives the session entries it writes. Owned work's is `owned-work`, which also marks the results the ledger hands the agent.
- **Terminal name.** The name Herdr shows for a delegate, serve or watch: the name its agent gave it.
- **Work label.** An hc label that owned work puts on its terminals for Herdr's agents list: `ow.kind` picks a row's icon, and `ow.group` and `ow.group.name` the group the row sits under.
- **Slice.** The systemd user slice a delegate, serve or watch runs in, nested below its parent's.
- **Child session.** A delegate's own pi session, kept apart from the sessions the human resumes.
- **Staged files.** A delegate's task message and its **brief**, written beside its child session for it to read.
- **Source stamp.** A hash of the source files that lay out a stored value, such as the owned-work ledger, so a reload can tell whether the code that wrote the value changed. An unreadable file gives a stamp no other read shares, so it never matches.
- **Subscribed at.** The monotonic clock reading, in nanoseconds, taken when the hc subscription that reported a list of terminals began. A live spawn missing from that list counts as lost only if the ledger learned of it before this reading.

## Skill menu

Terms from the skill-menu feature.

- **User-invocable.** Whether a skill shows in the `/` menu.

## Web

Terms from the web client and feature.

- **Page.** What reading one URL gives back: the URL asked for, the final URL after redirects, a title, the source that read it, an optional caveat, and a body of markdown or a file.
- **Source.** One way to read a URL, such as GitHub's API, npm, a direct fetch, or Exa's copy.
- **Via.** The name of the source that read a page, shown to the model beside the page.
- **Site source.** A source that reads a site's own API or files, whose answer is the whole page, so it is never judged thin or a bot check.
- **Saved page.** The whole of a fetched page, written to the web cache. A markdown page saves as one Markdown file. A file saves as itself plus a Markdown file of its text, which a file with no text, such as an image, lacks.
- **Untrusted content.** Page text and search highlights. They are data, never instructions.
- **Web cache.** The folder, readable only by the user, where fetched pages are saved.

## Usage

Terms from the usage feature, which shows `/usage`.

- **Card.** What `/usage` shows: one block per account and the time it read them.
- **Block.** One account in a card: the account, where its numbers came from, and its rows, or the reason it could not be read.
- **Meter.** One number read for an account, which becomes a row of its block, such as a rate-limit window's percent used.
- **Row.** One line of a block as the card shows it: a gauge or a note. The session stores a card's rows, not its meters, so a card read back shows what it showed when read.
- **Gauge.** A row that shows a share of a limit as a bar.
- **Note.** A row that shows a value with no limit to fill. A quiet note tells of something switched off and reads dimmed.
- **Probe.** A one-token message to a Claude account that cannot read the usage page, whose reply carries the rate-limit windows.
- **Estimate.** What pi priced its own replies at, from the models' list prices. It leaves out every other client that uses the same key.
- **Window.** A rate-limit window of an account's plan, such as `5-hour` or `weekly`, with the percent of it the account has used and when it resets.
- **Money.** An amount given as a whole number of a currency's minor unit and the exponent that places its decimal point, such as 884857 at exponent 2 for $8,848.57.
- **Extra usage.** What a Claude account spends past its plan's limits this month, against its monthly cap when it has one. It is on, or off with Anthropic's reason, such as `out_of_credits`.

## Cost

Terms from the cost feature, the cache feature and herdr-app's status bar. See ADR 0004.

- **Spend.** What a session tree, delegates included, priced its model calls at, at the list price pi stored on each. Unlike an **Estimate**, it covers one session tree.
- **Cache miss.** A reply that rewrote at full price at least 50,000 tokens of the prompt the session's last model call had sent, once some call in the session has read or written the cache.
- **Cost label.** The `pi.cost` hc label on a root agent's own terminal that holds the spend of the root and of each delegate below it, which herdr-app's status bar reads.
- **Session tree files.** The files a session tree's spend is read from: the root's own session file, and its delegates folder, which holds the session file of every delegate below the root at any level.
- **Read offset.** The byte in a session file where the cost feature's next read starts, just past the last whole line it read. A file shorter than its read offset was replaced, so the next read starts at 0.

## Claude accounts

Terms from the claude-accounts feature, which makes each **Claude account** a pi provider and moves a session off a **limited account**.

- **Login.** How a Claude account signs in: `oauth`, through Anthropic's OAuth flow, or `setup-token`.
- **Setup-token.** A token that `claude setup-token` prints and an account pastes once at `/login`. It has no refresh token, and it lacks the `user:profile` scope, so the account's plan comes from a **probe**, not the usage page.

## Loaded

Terms from the loaded feature and herdr-app's Skills panel. See ADR 0003.

- **Guide.** A skill, a principle or a playbook: a file of instructions an agent reads into its context when its trigger matches.
- **Guide name.** A principle's or a playbook's file name without `.md`. Only a file directly in its folder has one. The files in its subfolders are **reference files**.
- **In context.** A guide is in context when at least three of the lines of its body that no other guide shares, or all of them when it has fewer, appear in text the model sees now. It is **full** from 90% of those lines, and **partial** below that.
- **Context label.** The hc label on an agent's own terminal that lists the guides in its context.
- **Marker.** A guide and one line of its body whose presence in a session shows the guide reached it.
- **Guide event.** A moment, such as a commit or an edit of a `.ts` file, that the guides it names are written for.

## PHI routing

Terms for the harness's side of PHI routing. phi-router routes each request of a session on a `phi` model, and [its glossary](https://github.com/drsh4dow/phi-router/blob/main/GLOSSARY.md) defines its own terms, such as **open account**, **BAA account**, **lane**, **verdict**, **stub**, **pin** and **BAA repo**. See ADRs 0015, 0021 and 0027.

- **`phi` model.** A model of the `phi` provider that phi-router's pi package registers: `phi/auto`, `phi/sealed`, and `phi/<id>` for each Anthropic model of pi's catalog.
- **BAA provider.** A pi provider whose models may read PHI, so it runs outside phi-router: `ent`, then `openai`.
- **Protected session.** A session on a `phi` model. Its codemode scripts may not call models.
- **Held parent.** A session on a BAA provider or `phi/sealed`. Its delegates run on a BAA provider or `phi/sealed`, never on `phi/<id>`.
- **Routing parent.** A session on any other `phi` model. Its delegates run on `phi/<id>` when phi-router carries the id.
- **Canary.** A synthetic identifier planted in a scenario's files, so the scenario can search request bodies for it. Never real PHI.

## Compaction

Terms for what an agent keeps when pi compacts its session. See ADR 0010.

- **Compaction summary.** The text the harness writes, in the root and in every delegate, to stand in for the turns a compaction drops. It holds the **anchor**, the **narrative**, the **restored guides**, and the names of the **listed guides**.
- **Anchor.** The document a compaction summary carries whole: a root's state file, or a delegate's task message.
- **Narrative.** The part of a compaction summary that tells the work so far: the goal, the constraints still in force, the open work and the next steps.
- **Guide budget.** How much guide text one compaction summary restores.
- **Restored guide.** A guide that was **in context** before a compaction and fits in the guide budget, whose body the compaction summary carries. Not a reload, which restarts pi's extensions.
- **Listed guide.** A guide that was in context before a compaction but falls past the guide budget, which the summary names for the agent to read again.

## Checks

Terms for the check and queue commands.

- **Receipt.** A check that passed on one tree: its command, where it ran, when it passed, how long it took, and what it printed to each stream. The same command on the same tree prints it instead of running again.
- **Worktree.** Where a check ran: the repository's shared git folder, the worktree's root, the folder inside it, and the tree it would commit with every tracked, edited and untracked file added. Worktrees of one repository share receipts, and separate clones do not.
- **Caller in line.** A process in a queue, waiting for one of its places or holding one, known by its pid, its command and its folder. The code calls it `Holder`, which is not the owned-work **Holder**.

## Footer

Terms for the footer, which replaces pi's own.

- **Stats line.** The footer's second line: the time from the first message to the latest, the latest response's cache hit rate, the session's cost and the context use, with the model on the right. It shows no token counters. The footer's other lines match pi's. Unlike pi's, it never shows where a virtual model routed the latest response, since pi gives extensions no way to tell a virtual model apart.

## Cache

Terms for the cache feature. **Cache miss** is under Cost.

- **Miss cause.** What a cache miss records as a reason it happened: idle past the cache lifetime, a model change, a compaction, a context edit, a changed prompt or changed tools. A miss with no cause is one that none of these explains.
- **Request head.** The system prompt and tool declarations a request sends ahead of the conversation. The cache feature compares each request's head with the last one that reached the model, so it names a prompt or tools change a hook makes only inside the request.

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
- **State folder.** The folder where work that outlives a turn keeps its state, its todo list, its decision trail, and its action items: `~/.local/state/pi-agent/<project>/<work>`. Agents write it through their tools.
- **Todo list.** The root's checklist for one piece of work: one line per step of each playbook it runs, plus its own items. The first open line is the current step.
- **State label.** The hc label on a root agent's own terminal that names the state folder its session last wrote to.
- **Trace and Actions panels.** herdr-app panels that draw the todo list and decision trail, or the action items, of the focused agent's root.
- **Known limit.** A finding that fails no acceptance criterion, gate, or doc line, that no user in good faith has a path to, and that causes no harm that cannot be undone. Not a **cut**.
- **Cut.** A finding whose fix removes more production code than it adds and keeps behavior: a copy of logic that exists elsewhere, a module that fails the deletion test, a guard for a case that cannot occur, code nothing reads, an option nobody asked for. The verdict on the **cut pass** branch confirms the behavior kept.
- **Cut pass.** One owner that applies cuts across the combined diff of a **wave**. Subtraction is its whole task.
- **Frontier.** The tickets whose blockers are all done.
- **Wave.** The slices that were on the frontier together and have landed.
- **One-way door.** A shape that is costly to undo once other work builds on it: a schema, a wire format, or an interface another slice builds on.
- **Non-goal.** Something a ticket says its closing PR leaves out.
- **Repair round.** A fix pushed after a PR's full review, and the check that judges it.
- **Decision trail.** The record of each decision the agent made, with its why, evidence, and result.
- **Action item.** Something the work needs from the human that no agent can do on its own, with its **only-you reason**.
- **Only-you reason.** The line of an action item that says why only the human can do it, as one of these kinds: a decision, an approval, an irreversible action, or access the agent lacks.

## Driver

Terms from the scenario driver in `tools/driver/`, which proves a runtime fact against the real pi. See ADR 0026.

- **Run core.** The terminal core a driver run starts for itself. `HC_TERMINAL_SOCKET` names its socket, and every pi of the run starts its delegates in it.
- **Message.** A prompt or a steering message as a scenario writes it: its text, or its text and images.
- **Loaded record.** What one pi of a run runs on, as the probe extension inside it reports it: its own pi `VERSION`, which can differ from the pi the driver resolved, its model, context window, extensions and settings, any error pi gave for `models.json`, and the core it starts its delegates in.
- **Session.** In the driver, one pi session file as it stood when the driver read it.
- **Session id.** The id in a pi session file's header. owned-work records a delegate's as its `child_session_id`.
- **Settled reply.** The root's last turn-ending text, once every job it started has settled and no owned-work entry follows it.
