import { expect, test } from "bun:test";

import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { ClaudeUsage, ClaudeUsageError, weeklyWindow } from "#src/client/claude-usage/index.ts";
import { piHost } from "#src/client/pi-host/index.ts";
import { type AccountId, accounts } from "./accounts.ts";
import { type PlanReader, roomiestAccount } from "./quota.ts";

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const offered = [
	{ ...opus, provider: "ultra-a" },
	{ ...opus, provider: "ultra-b" },
	{ ...opus, provider: "ent" },
	{ ...opus, provider: "ultra-a", id: "claude-solo" },
];

const registry = (): PlanReader => ({ getAll: () => offered, getApiKeyForProvider: Promise.resolve.bind(Promise) });

const meters = (used: Partial<Record<string, number>>, reads: Array<string> = [], hung: ReadonlyArray<string> = []) => {
	const hangs = Rec.fromEntries(Arr.map(hung, (account) => [account, Effect.never] as const));

	const weekly = (token: Redacted.Redacted) => {
		const account = Redacted.value(token);

		reads.push(account);

		const answer = Option.match(Option.fromUndefinedOr(used[account]), {
			onNone: () => Effect.fail(ClaudeUsageError.make({ message: `${account} is down` })),
			onSome: (percent) => Effect.succeed([{ name: weeklyWindow, percent, resetsAt: Option.none() }]),
		});

		return Option.getOrElse(Rec.get(hangs, account), () => answer);
	};

	return Layer.mock(ClaudeUsage)({
		plan: (token) => Effect.map(weekly(token), (windows) => ({ windows, spend: Option.none() })),
		probe: ({ token }) => weekly(token),
	});
};

const accountNamed = (wanted: AccountId) =>
	Arr.findFirst(accounts, (account) => account.id === wanted).pipe(Option.getOrThrow);

const roomiest = (from: AccountId, id: string, reader: PlanReader = registry()) =>
	Effect.map(roomiestAccount({ registry: reader, from: accountNamed(from), id }), (account) => account.id);

const picked = <Picked>({
	used,
	starting,
	reads = [],
	check,
}: {
	readonly used: Partial<Record<AccountId, number>>;
	readonly starting: Effect.Effect<Picked, never, ClaudeUsage>;
	readonly reads?: Array<string>;
	readonly check: (accounts: Picked) => void;
}) => piHost(meters(used, reads)).run(Effect.map(starting, check));

interface Row {
	readonly name: string;
	readonly from: AccountId;
	readonly id?: string;
	readonly used: Partial<Record<AccountId, number>>;
	readonly starts: AccountId;
}

const rows: ReadonlyArray<Row> = [
	{
		name: "a delegate starts on the account with the most of its week left",
		from: "ultra-a",
		used: { "ultra-a": 100, "ultra-b": 79 },
		starts: "ultra-b",
	},
	{
		name: "a delegate stays on its parent's account while it has the most left",
		from: "ultra-b",
		used: { "ultra-a": 80, "ultra-b": 20 },
		starts: "ultra-b",
	},
	{
		name: "a tie keeps the parent's account",
		from: "ultra-a",
		used: { "ultra-a": 50, "ultra-b": 50 },
		starts: "ultra-a",
	},
	{ name: "no meter answering keeps the parent's account", from: "ultra-a", used: {}, starts: "ultra-a" },
	{ name: "a meter that fails rules its account out", from: "ultra-a", used: { "ultra-b": 90 }, starts: "ultra-b" },
	{
		name: "a protected session never leaves ent",
		from: "ent",
		used: { ent: 100, "ultra-a": 0, "ultra-b": 0 },
		starts: "ent",
	},
	{
		name: "an account without the model is no choice",
		from: "ultra-a",
		id: "claude-solo",
		used: { "ultra-a": 100, "ultra-b": 0 },
		starts: "ultra-a",
	},
];

test.each(rows)("$name", ({ from, id = opus.id, used, starts }) =>
	picked({
		used,
		starting: roomiest(from, id),
		check: (account) => {
			expect(account).toBe(starts);
		},
	}),
);

test("a burst of delegate starts reads each meter once", () => {
	const reads: Array<string> = [];
	const reader = registry();

	return picked({
		used: { "ultra-a": 90, "ultra-b": 10 },
		starting: Effect.zip(roomiest("ultra-a", opus.id, reader), roomiest("ultra-a", opus.id, reader)),
		reads,
		check: (starts) => {
			expect(starts).toEqual(["ultra-b", "ultra-b"]);
			expect(Arr.sort(reads, Order.String)).toEqual(["ultra-a", "ultra-b"]);
		},
	});
});

test("a meter that never answers is left out after five seconds", () => {
	const starting = Effect.gen(function* () {
		const picking = yield* Effect.forkChild(roomiest("ultra-b", opus.id));

		yield* TestClock.adjust("5 seconds");

		const account = yield* Fiber.join(picking);

		expect(account).toBe("ultra-a");
	});

	return piHost(Layer.merge(meters({ "ultra-a": 90 }, [], ["ultra-b"]), TestClock.layer())).run(starting);
});
