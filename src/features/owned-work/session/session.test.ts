import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { BriefSources } from "#src/client/brief-sources/index.ts";
import { Gh } from "#src/client/github/index.ts";
import { PiCli, piHost, PiSessions } from "#src/client/pi/index.ts";
import { ClaudeUsage } from "#src/client/providers/index.ts";
import { Hc, HerdrApp, Slices } from "#src/client/terminals/index.ts";
import { Ledger, Transitions } from "#src/features/owned-work/ledger/index.ts";
import { MonotonicNanos, WorkRef } from "#src/features/owned-work/work.ts";
import { take } from "./handover.ts";
import { awaitOn, cancelUnless, type Current, delegatesDirOf, end, exitsWhenPromptResolves } from "./session.ts";

const rows = [
	{ mode: "print", exits: true },
	{ mode: "json", exits: true },
	{ mode: "rpc", exits: false },
	{ mode: "tui", exits: false },
] as const;

const exitPhrase = (exits: boolean): string => (exits ? "exits" : "does not exit");

test.each(Arr.map(rows, (row) => ({ ...row, does: exitPhrase(row.exits) })))(
	"pi in $mode mode $does once its prompt resolves",
	({ mode, exits }) => {
		expect(exitsWhenPromptResolves(mode)).toBe(exits);
	},
);

test("a hook still waiting when the session shuts down ends with no reply, and a hook that dies still rejects", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const host = piHost(Layer.empty);
			const waiter = piHost(Layer.empty);
			const run = <Reply>(hook: Effect.Effect<Reply>): Promise<Reply | undefined> => waiter.run(awaitOn(host)(hook));
			const died = yield* Effect.exit(Effect.tryPromise({ try: () => run(Effect.die("boom")), catch: String }));
			const waiting = run(Effect.never);

			yield* Effect.promise(() => host.dispose());

			const reply = yield* Effect.promise(() => waiting);

			expect(died._tag).toBe("Failure");
			expect(reply).toBeUndefined();
		}),
	));

const places = [
	{ name: "a saved session keeps delegates beside it", sessionDir: "/s", dir: /^\/s\/delegates$/u },
	{
		name: "a --no-session run keeps delegates in a temp folder named at random",
		sessionDir: "",
		dir: /^\/t\/pi-delegates-[0-9a-f-]{36}$/u,
	},
] as const;

test.each(places)("$name", ({ sessionDir, dir }) => {
	expect(delegatesDirOf({ sessionDir, tmpDir: "/t" })).toMatch(dir);
});

test("two --no-session runs never share a delegates folder", () => {
	expect(delegatesDirOf({ sessionDir: "", tmpDir: "/t" })).not.toBe(delegatesDirOf({ sessionDir: "", tmpDir: "/t" }));
});

const leaving = ({
	running,
	hasUI,
	agrees,
}: {
	readonly running: ReadonlyArray<string>;
	readonly hasUI: boolean;
	readonly agrees: boolean;
}) => {
	const asked = { times: 0 };
	const ledger = { running: Effect.succeed(Arr.map(running, WorkRef)) };

	const ctx = {
		hasUI,
		ui: {
			confirm: () => {
				asked.times += 1;

				return Promise.resolve(agrees);
			},
		},
	};

	return Effect.map(cancelUnless(ctx)(ledger), (reply) => ({ reply, asked: asked.times }));
};

const runningWork = ["delegate-1", "watch-2"];

test.each([
	{
		name: "with nothing running goes ahead without asking",
		running: [],
		hasUI: true,
		agrees: false,
		reply: {},
		asked: 0,
	},
	{
		name: "while work runs asks, and a yes goes ahead",
		running: runningWork,
		hasUI: true,
		agrees: true,
		reply: {},
		asked: 1,
	},
	{
		name: "while work runs asks, and a no keeps the session",
		running: runningWork,
		hasUI: true,
		agrees: false,
		reply: { cancel: true },
		asked: 1,
	},
	{
		name: "while work runs with no UI to ask goes ahead",
		running: runningWork,
		hasUI: false,
		agrees: false,
		reply: {},
		asked: 0,
	},
])("leaving a session $name", ({ reply, asked, ...situation }) =>
	Effect.runPromise(
		Effect.map(leaving(situation), (left) => {
			expect(left).toEqual({ reply, asked });
		}),
	),
);

test("a session that shuts down for a reload is forgotten before its ledger freezes, so no later hook reaches the frozen ledger", () => {
	const current: Current = { session: Option.none() };
	const sessionKnownAtFreeze: Array<boolean> = [];

	const services = Layer.mergeAll(
		Layer.mock(Ledger)({
			freeze: Effect.sync(() => {
				sessionKnownAtFreeze.push(Option.isSome(current.session));

				return Transitions.initial("root", 4, MonotonicNanos(0n));
			}),
		}),
		Layer.mock(PiCli)({ release: Effect.void }),
		Layer.mock(Slices)({ wrap: (spec) => spec }),
		Layer.mock(Hc)({}),
		Layer.mock(PiSessions)({}),
		Layer.mock(HerdrApp)({}),
		Layer.mock(Gh)({}),
		Layer.mock(BriefSources)({}),
		Layer.mock(ClaudeUsage)({}),
		NodeServices.layer,
	);

	current.session = Option.some({
		host: piHost(services),
		lineage: { agentKey: "k1", stamp: 7 },
		relay: { waiter: Option.none() },
		ownTerminal: Option.none(),
		passEnv: {},
	});

	return Effect.runPromise(
		Effect.map(end(current)({ type: "session_shutdown", reason: "reload" }), () => {
			expect({ sessionKnownAtFreeze, handedOver: Option.isSome(take()) }).toEqual({
				sessionKnownAtFreeze: [false],
				handedOver: true,
			});
		}),
	);
});
