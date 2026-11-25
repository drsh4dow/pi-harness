import { expect, test } from "bun:test";

import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Function from "effect/Function";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { piHost } from "#src/client/pi/index.ts";
import { accounts } from "./accounts.ts";
import { endedOnRateLimit, failOver, failoverOf, type Limits } from "./failover.ts";

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const find = (provider: string, id: string) =>
	Arr.some(accounts, (account) => account.id === provider) && id === opus.id ? { ...opus, provider } : undefined;

const runnableModel = (provider: string, id: string) => Option.fromUndefinedOr(find(provider, id));

const withoutUltraB = (provider: string, id: string) =>
	provider === "ultra-b" ? Option.none() : runnableModel(provider, id);

const now = DateTime.makeUnsafe("2026-11-18T11:04:37Z");

const at = (time: string) => DateTime.makeUnsafe(`2026-11-18T${time}Z`);

const on = (provider: string) => ({ ...opus, provider });

const personalLimited: Limits = new Map([
	["ultra-a", at("12:00:00")],
	["ultra-b", at("14:00:00")],
]);

const allLimited: Limits = new Map([...personalLimited, ["ent", at("13:00:00")]]);

const failovers: ReadonlyArray<{
	readonly name: string;
	readonly request: Omit<Parameters<typeof failoverOf>[0], "now">;
	readonly goes: string;
}> = [
	{
		name: "a session on ultra-a moves to ultra-b while ultra-b is open",
		request: { current: on("ultra-a"), runnableModel, limits: new Map([["ultra-a", at("12:00:00")]]) },
		goes: "move ultra-b",
	},
	{
		name: "a session on ultra-b moves to ultra-a while ultra-a is open",
		request: { current: on("ultra-b"), runnableModel, limits: new Map() },
		goes: "move ultra-a",
	},
	{
		name: "a session never moves back to an account still limited, and goes on to ent",
		request: { current: on("ultra-a"), runnableModel, limits: personalLimited },
		goes: "move ent",
	},
	{
		name: "an account whose limit has passed is open again",
		request: {
			current: on("ultra-a"),
			runnableModel,
			limits: new Map([...personalLimited, ["ultra-b", at("11:00:00")]]),
		},
		goes: "move ultra-b",
	},
	{
		name: "when every account is limited, the session waits for the one back first",
		request: { current: on("ultra-b"), runnableModel, limits: allLimited },
		goes: "wait ultra-a until 2026-11-18T12:00:00.000Z",
	},
	{
		name: "the account back first may be the session's own",
		request: { current: on("ultra-a"), runnableModel, limits: new Map([...allLimited, ["ultra-a", at("11:30:00")]]) },
		goes: "wait ultra-a until 2026-11-18T11:30:00.000Z",
	},
	{
		name: "a session on ent waits for ent and never moves to a personal account",
		request: { current: on("ent"), runnableModel, limits: allLimited },
		goes: "wait ent until 2026-11-18T13:00:00.000Z",
	},
	{
		name: "an account without the session's model is skipped",
		request: { current: on("ultra-a"), runnableModel: withoutUltraB, limits: new Map([["ultra-a", at("12:00:00")]]) },
		goes: "move ent",
	},
	{
		name: "a phi/auto selection is the router's to move, not the failover's",
		request: { current: on("phi"), runnableModel, limits: allLimited },
		goes: "none",
	},
	{
		name: "a session on no Claude account has nowhere to go",
		request: { current: { ...opus, provider: "openai", id: "gpt-6.1-sol" }, runnableModel, limits: allLimited },
		goes: "none",
	},
	{
		name: "a session on no model has nowhere to go",
		request: { current: undefined, runnableModel, limits: allLimited },
		goes: "none",
	},
];

const goesOf = (request: Parameters<typeof failoverOf>[0]) =>
	Option.match(failoverOf(request), {
		onNone: () => "none",
		onSome: (failover) =>
			failover.kind === "move"
				? `move ${failover.model.provider}`
				: `wait ${failover.model.provider} until ${DateTime.formatIso(failover.until)}`,
	});

test.each(failovers)("a rate limit fails over to an open account or waits: $name", ({ request, goes }) => {
	expect(goesOf({ ...request, now })).toBe(goes);
});

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const answered = {
	role: "assistant" as const,
	content: [],
	api: "anthropic-messages" as const,
	provider: "ultra-a",
	model: "claude-opus-5-5",
	usage: { ...zero, totalTokens: 0, cost: { ...zero, total: 0 } },
	stopReason: "stop" as const,
	timestamp: 0,
};

const failed = (errorMessage: string) => ({ ...answered, stopReason: "error" as const, errorMessage });

const asked = { role: "user" as const, content: "Find the bug.", timestamp: 0 };

const rateLimited = failed(
	'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}',
);

const overloaded = failed('529 {"type":"error","error":{"type":"overloaded_error"}}');

const runEnds = [
	{ name: "a run whose last reply is a 429 ended on a rate limit", messages: [asked, rateLimited], limited: true },
	{ name: "a run that recovered after a 429 did not", messages: [asked, rateLimited, answered], limited: false },
	{ name: "an overloaded API is not an account's rate limit", messages: [asked, overloaded], limited: false },
	{ name: "a run that ends on a user message did not", messages: [asked], limited: false },
];

test.each(runEnds)("$name", ({ messages, limited }) => {
	expect(endedOnRateLimit(messages)).toBe(limited);
});

interface Seen {
	readonly moves: Array<string>;
	readonly status: Array<string | undefined>;
}

const failingOver = ({
	limits,
	signal = new AbortController().signal,
	loggedIn = Function.constTrue,
}: {
	readonly limits: Limits;
	readonly signal?: AbortSignal;
	readonly loggedIn?: (provider: string) => boolean;
}) => {
	const seen: Seen = { moves: [], status: [] };

	const pi = {
		getThinkingLevel: () => "high" as const,
		setThinkingLevel: Function.constVoid,
		setModel: ({ provider }: { readonly provider: string }) => {
			seen.moves.push(provider);

			return Promise.resolve(true);
		},
	};

	const ui = {
		notify: Function.constVoid,
		setStatus: (_key: string, text: string | undefined) => {
			seen.status.push(text);
		},
	};

	const modelRegistry = {
		find,
		hasConfiguredAuth: ({ provider }: { readonly provider: string }) => loggedIn(provider),
	};

	return { seen, run: failOver({ pi, ctx: { model: on("ultra-a"), signal, ui, modelRegistry }, limits }) };
};

const someday = DateTime.makeUnsafe("2099-01-01T00:00:00Z");

test("an account without a login is never where a session moves", () => {
	const { seen, run } = failingOver({ limits: new Map([["ultra-a", someday]]), loggedIn: (id) => id !== "ultra-b" });

	return Effect.runPromise(
		Effect.map(run, () => {
			expect(seen.moves).toEqual(["ent"]);
		}),
	);
});

const showedTheWait = ({ status }: Seen) => {
	expect(status).toHaveLength(2);
	expect(status[0]).toContain("rate-limited until");
	expect(status[1]).toBeUndefined();
};

test("Escape ends the wait, and the session stays where it is", () => {
	const limits = new Map(Arr.map(accounts, ({ id }) => [id, someday] as const));
	const { seen, run } = failingOver({ limits, signal: AbortSignal.abort() });

	return Effect.runPromise(
		Effect.map(run, () => {
			expect(seen.moves).toEqual([]);
			showedTheWait(seen);
		}),
	);
});

const minutesIn = (minutes: number) => DateTime.makeUnsafe(minutes * 60_000);

test("the wait ends at the first reset, and the session moves to that account", () => {
	const limits: Limits = new Map([
		["ultra-a", minutesIn(120)],
		["ultra-b", minutesIn(1)],
		["ent", minutesIn(180)],
	]);

	const { seen, run } = failingOver({ limits });

	const waited = Effect.gen(function* () {
		const failing = yield* Effect.forkChild(run);

		yield* TestClock.adjust("1 minute");
		yield* Fiber.join(failing);

		expect(seen.moves).toEqual(["ultra-b"]);
		showedTheWait(seen);
	});

	return piHost(TestClock.layer()).run(waited);
});
