---
status: proposed
---

# A wait call delivers results in its reply

Results reached an agent only at the end of a turn, by a wake while idle, or in a `cancel` reply. An agent that held a watch or a delegate and wanted to keep its turn had no call that waits for them, so it ran `sleep 900; cat log`, and a result that settled meanwhile sat behind the sleep. A retro of 1,666 sessions counted 25.8 h a week of this oversleep, and 202 waits where the model said it would end its turn and slept anyway. The warning that pi printed after such a call (`polling.ts`) changed nothing: 166 sessions ran 502 more waits after their first warning.

So owned-work offers a `wait` tool, a long poll like `wait -n`. It blocks until a job in its scope (any job the agent holds, or the refs it names) has a result to deliver, or none in its scope runs, or its stop fires: the timeout (240 s by default, 3600 s at most), a message the human queued, or Escape. Then it takes every result due in one ledger transition, as a turn's end would, and returns them as text that reads as their wakes do, then names the jobs still running. A result it returns is marked delivered, so the turn's end does not deliver it again. GLOSSARY "Deliver" gains this path and "Wait" names the call.

Exactly once rests on two facts. Every delivery (a turn's end, a wake, a `cancel` reply, a `wait` reply) is a transition under the ledger's one lock that marks what it hands out in the same step, so a job that settles as a wait returns is either taken by the wait, when its settle ran first, or left for the turn's end. And nothing discards a `wait` reply once its transition ran: Escape is one of its stop reasons rather than an interrupt, because pi records a tool's reply that comes after an abort, and `wait` is `model-only`, so a codemode script cannot call it and drop what it took.

pi fires `input` before it queues a message and has no event once it has, so the wait checks `ctx.hasPendingMessages()` every 250 ms. That count holds steers and follow-ups alike. A steer follows the reply on its own, while a follow-up arrives only when the turn ends, so the reply says a message is queued and to end the turn if it does not follow.

## Considered options

- **Refuse a bash or codemode call that waits.** Rejected by the human after four reviews of #254. Judging whether a command waits took a shell parser, each review found a shell form it misread, and a refused model can turn to a busy loop that burns CPU instead.
- **Deliver into a running sleep** by aborting it when a held job settles. Left for later. It also needs to tell a wait from other work in a command.
- **Keep the post-sleep warning, pointed at `wait`.** Rejected. It fires after the time is lost, stays silent when a job settled during the sleep, and did not change behavior.

## Consequences

- A sleep while work is held still oversleeps. Prose in the tool guideline, the handle's `next` and the role files points at `wait` or at ending the turn.
- A wait longer than the prompt cache's five minutes lets the cache go cold, as any long tool call does. The default timeout stays under it, and a longer wait is better spent idle.
- While a follow-up sits in pi's queue, every wait returns at once and tells the agent to end its turn, since pi does not say which kind of message waits.
