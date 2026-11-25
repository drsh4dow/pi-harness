import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { Groups } from "#src/features/owned-work/ledger/groups/index.ts";
import { waking } from "#src/features/owned-work/ledger/lifetime/index.ts";
import { Out } from "#src/features/owned-work/ledger/out/index.ts";
import { Draft, type LedgerState, type Step } from "#src/features/owned-work/step.ts";
import type { LedgerError, Settled, WorkRef } from "#src/features/owned-work/work.ts";

/** The jobs a wait is for: any the agent holds, or the ones it names. */
type WaitScope = Option.Option<ReadonlyArray<WorkRef>>;

export interface Waited {
	readonly results: ReadonlyArray<Settled>;
	/** The jobs in the wait's scope that still run. */
	readonly running: ReadonlyArray<WorkRef>;
}

const withinScope =
	(scope: WaitScope) =>
	(ref: WorkRef): boolean =>
		Option.match(scope, { onNone: () => true, onSome: (refs) => refs.includes(ref) });

const refused = (state: LedgerState, scope: WaitScope): Option.Option<LedgerError> =>
	Option.flatMap(scope, (refs) => Arr.findFirst(refs, (ref) => Groups.refused(Draft.of(state), ref)));

const over = (state: LedgerState, scope: WaitScope): boolean => {
	const within = withinScope(scope);
	const settled = Arr.some(Draft.deliverable(Draft.of(state), within), (work) => !Draft.isServe(work));

	return settled || !Arr.some(waking(state), within);
};

const take = (state: LedgerState, scope: WaitScope): Step<Waited> => {
	const draft = Draft.of(state);
	const results = Draft.takeWithJob(draft);

	return Draft.finish(draft, { results, running: Arr.filter(waking(state), withinScope(scope)) });
};

export type Wait = (scope: WaitScope, stop: Effect.Effect<void>) => Effect.Effect<Waited, LedgerError>;

const waitOn =
	(state: SubscriptionRef.SubscriptionRef<LedgerState>, takeIn: (scope: WaitScope) => Effect.Effect<Waited>): Wait =>
	(scope, stop) =>
		Effect.gen(function* () {
			const current = yield* SubscriptionRef.get(state);
			const problem = refused(current, scope);

			if (Option.isSome(problem)) {
				return yield* problem.value;
			}

			const ended = SubscriptionRef.changes(state).pipe(
				Stream.filter((latest) => over(latest, scope)),
				Stream.runHead,
				Effect.asVoid,
			);

			yield* Effect.raceFirst(ended, stop);

			return yield* Effect.uninterruptible(takeIn(scope));
		});

const messageQueued = (ctx: Pick<ExtensionContext, "hasPendingMessages">): Effect.Effect<void> =>
	Effect.suspend(() =>
		ctx.hasPendingMessages() ? Effect.void : Effect.andThen(Effect.sleep(Duration.millis(250)), messageQueued(ctx)),
	);

const aborted = (signal: AbortSignal | undefined): Effect.Effect<void> =>
	signal === undefined
		? Effect.never
		: Effect.callback((resume) => {
				const stopped = () => {
					resume(Effect.void);
				};

				signal.addEventListener("abort", stopped, { once: true });

				if (signal.aborted) {
					stopped();
				}

				return Effect.sync(() => {
					signal.removeEventListener("abort", stopped);
				});
			});

const stop = ({
	after,
	signal,
	ctx,
}: {
	readonly after: Duration.Duration;
	readonly signal: AbortSignal | undefined;
	readonly ctx: Pick<ExtensionContext, "hasPendingMessages">;
}): Effect.Effect<void> => Effect.raceAll([Effect.sleep(after), messageQueued(ctx), aborted(signal)]);

const runningNote = (running: ReadonlyArray<WorkRef>, messagePending: boolean) =>
	messagePending
		? `${Arr.join(running, ", ")} still run, and each result wakes you once you end your turn.`
		: `${Arr.join(running, ", ")} still run. Call wait again, or end your turn and each result wakes you.`;

const messageNote =
	"A message from the human is queued. If it does not follow this reply, end your turn to receive it.";

const notesOf = ({ results, running }: Waited, messagePending: boolean): Array<string> => {
	const notes = messagePending ? [messageNote] : [];

	if (Arr.isReadonlyArrayNonEmpty(running)) {
		return [runningNote(running, messagePending), ...notes];
	}

	return Arr.isReadonlyArrayNonEmpty(results)
		? notes
		: ["No result waits, and nothing you waited for runs.", ...notes];
};

const reply = (waited: Waited, messagePending: boolean) =>
	Effect.map(
		Effect.forEach(waited.results, (settled) => Out.text(Out.result(settled))),
		(texts) => ({
			content: Arr.map([...texts, ...notesOf(waited, messagePending)], (text) => ({ type: "text" as const, text })),
			details: { results: Arr.map(waited.results, Out.result), running: waited.running },
			isError: false,
		}),
	);

export const Waiting = { take, waitOn, stop, reply };
