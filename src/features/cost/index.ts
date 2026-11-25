import type { ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { appendedLines, piHost, sessionFileById } from "#src/client/pi/index.ts";
import { labelTerminal, TerminalAddress } from "#src/client/terminals/index.ts";
import { emptyTally, type StartedDelegate, type Tally, tallyLines } from "./tally.ts";

/** The hc label on a root agent's own terminal that holds its `CostLabel`, which herdr-app's status bar reads. */
export const labelKey = "pi.cost";

const Usd = Schema.Finite;

export const CostLabel = Schema.Struct({
	own: Usd,
	delegates: Schema.Array(Schema.Struct({ name: Schema.String, usd: Usd })),
});

export type CostLabel = typeof CostLabel.Type;

const encodeLabel = Schema.encodeEffect(Schema.fromJsonString(CostLabel));

export interface SessionTreeFiles {
	readonly root: string;
	readonly delegates: string;
}

interface Followed {
	readonly readOffset: number;
	readonly tally: Tally;
}

const unread: Followed = { readOffset: 0, tally: emptyTally };

const usd = (amount: number) => Math.round(amount * 10_000) / 10_000;

const locate = Effect.fn("locate")(function* (
	located: Map<string, string>,
	dir: string,
	{ childSessionId }: StartedDelegate,
) {
	const known = located.get(childSessionId);

	if (known !== undefined) {
		return Option.some(known);
	}

	const path = yield* sessionFileById({ dir, id: childSessionId });

	if (Option.isSome(path)) {
		located.set(childSessionId, path.value);
	}

	return path;
});

export const treeReader = (files: SessionTreeFiles) => {
	const followed = new Map<string, Followed>();
	const located = new Map<string, string>();

	const advance = Effect.fn("advance")(function* (path: string) {
		const before = followed.get(path) ?? unread;
		const appended = yield* appendedLines({ path, offset: before.readOffset });

		if (Option.isNone(appended)) {
			return emptyTally;
		}

		const { replaced, text: wholeLines, offset } = appended.value;
		const tally = tallyLines({ tally: replaced ? emptyTally : before.tally, wholeLines });

		followed.set(path, { readOffset: offset, tally });

		return tally;
	});

	const spentBelow = (
		started: ReadonlyArray<StartedDelegate>,
	): Effect.Effect<CostLabel["delegates"], PlatformError.PlatformError, Effect.Services<ReturnType<typeof locate>>> =>
		Effect.map(
			Effect.forEach(started, (delegate) =>
				Effect.gen(function* () {
					const path = yield* locate(located, files.delegates, delegate);
					const tally = Option.isSome(path) ? yield* advance(path.value) : emptyTally;
					const below = yield* spentBelow(tally.started);

					return [{ name: delegate.name, usd: usd(tally.usd) }, ...below];
				}),
			),
			Arr.flatten,
		);

	const read = Effect.gen(function* () {
		const own = yield* advance(files.root);
		const delegates = yield* spentBelow(own.started);

		return { own: usd(own.usd), delegates } satisfies CostLabel;
	});

	return { read };
};

const ownTerminal = Effect.map(Effect.option(Config.String("HC_TERMINAL_ID")), Option.map(TerminalAddress));

const publish = (files: SessionTreeFiles, terminal: TerminalAddress) => {
	const reader = treeReader(files);
	let published = "";

	const refresh = Effect.gen(function* () {
		const label = yield* reader.read;
		const text = yield* encodeLabel(label);

		if (text !== published) {
			yield* labelTerminal({ terminal, labels: { [labelKey]: text } });
			published = text;
		}
	});

	const clear = Effect.ignore(labelTerminal({ terminal, labels: { [labelKey]: "" } }), { log: "Warn" });

	return refresh.pipe(
		Effect.ignore({ log: "Warn" }),
		Effect.repeat(Schedule.spaced("2 seconds")),
		Effect.ensuring(clear),
	);
};

export const labelSpend = (session: Pick<SessionManager, "getSessionFile" | "getSessionDir">) =>
	Option.match(Option.fromUndefinedOr(session.getSessionFile()), {
		onNone: () => Effect.void,
		onSome: (root) =>
			Effect.flatMap(
				ownTerminal,
				Option.match({
					onNone: () => Effect.void,
					// Where owned-work puts a root's delegates, at every level (`delegatesDirOf`).
					onSome: (terminal) => publish({ root, delegates: `${session.getSessionDir()}/delegates` }, terminal),
				}),
			),
	});

/**
 * Keeps the `pi.cost` label on a root agent's hc terminal equal to what its session tree has spent at list prices, and
 * removes it when the session ends. Delegates never load it: their spend reaches the root's label through their files.
 * Outside herdr-core, or without a session file, it does nothing.
 */
export const cost = (pi: Pick<ExtensionAPI, "on">) => {
	const host = piHost(NodeServices.layer);
	let running: Option.Option<Fiber.Fiber<unknown>> = Option.none();

	pi.on("session_start", (_event, ctx) => {
		running = Option.some(host.fork(labelSpend(ctx.sessionManager)));
	});

	pi.on("session_shutdown", () => {
		const fiber = running;

		running = Option.none();

		return Option.match(fiber, {
			onNone: () => Promise.resolve(),
			onSome: (started) => host.run(Fiber.interrupt(started)),
		});
	});
};
