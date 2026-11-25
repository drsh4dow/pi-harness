import { expect, test } from "bun:test";

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import { SetupFailed } from "#tools/driver/failed.ts";
import type { Loaded } from "./probe.ts";
import type { Sessions } from "./sessions.ts";
import { type AskedOfRoot, tookSetup, unmetOf } from "./took.ts";

const socket = "/t/pi-driver/pi-driver-42-0abc12/herdr-core/pi-driver-42-0abc12.sock";
const compaction = { enabled: true, reserveTokens: 10_000, keepRecentTokens: 5000 };

const asked: AskedOfRoot = {
	model: "p/m",
	contextWindow: 40_000,
	setup: { settings: { compaction }, models: { prov: { modelOverrides: { mod: { contextWindow: 40_000 } } } } },
	runCoreSocket: socket,
};

const taken: Loaded = {
	version: "1.5.2",
	model: "p/m",
	contextWindow: 40_000,
	extensions: [],
	settings: { compaction, theme: "dark" },
	modelsError: Option.none(),
	socket: Option.some(socket),
};

const rows: ReadonlyArray<{
	readonly name: string;
	readonly asked?: Partial<AskedOfRoot>;
	readonly loaded?: Partial<Loaded>;
	readonly expected: ReadonlyArray<string>;
}> = [
	{ name: "a root that took everything misses nothing", expected: [] },
	{
		name: "a dropped models.json misses the context window and names pi's error",
		loaded: { contextWindow: 1_000_000, modelsError: Option.some("bad providers") },
		expected: ["its context window is 1000000, not 40000", "it dropped models.json: bad providers"],
	},
	{ name: "another model is a miss", loaded: { model: "p/other" }, expected: ["it runs p/other, not p/m"] },
	{
		name: "a settings key with another value is a miss",
		loaded: { settings: { compaction: { ...compaction, reserveTokens: 16_384 } } },
		expected: ["its settings key compaction is not the one set"],
	},
	{
		name: "a settings key the record cannot confirm is refused, even when the record shows it",
		asked: { setup: { settings: { compaction, contextWindow: 40_000 } } },
		loaded: { settings: { compaction, contextWindow: 40_000 } },
		expected: ["the driver confirms only the settings keys compaction and packages, not contextWindow"],
	},
	{
		name: "a compaction field pi does not read is refused",
		asked: { setup: { settings: { compaction: { ...compaction, reserveTokns: 1 } } } },
		loaded: { settings: { compaction: { ...compaction, reserveTokns: 1 } } },
		expected: [
			"the driver cannot confirm the setting compaction.reserveTokns, only compaction.enabled, compaction.reserveTokens, compaction.keepRecentTokens",
		],
	},
	{
		name: "an empty compaction is refused",
		asked: { setup: { settings: { compaction: {} } } },
		loaded: { settings: { compaction: {} } },
		expected: [
			"the driver cannot confirm the setting compaction, only compaction.enabled, compaction.reserveTokens, compaction.keepRecentTokens",
		],
	},
	{
		name: "an unknown setting set to an empty object is refused",
		asked: { setup: { settings: { compaction, bogusSetting: {} } } },
		loaded: { settings: { compaction, bogusSetting: {} } },
		expected: ["the driver confirms only the settings keys compaction and packages, not bogusSetting"],
	},
	{
		name: "a dotted top-level key is refused, though pi records it as set",
		asked: { setup: { settings: { "compaction.enabled": false } } },
		loaded: { settings: { compaction, "compaction.enabled": false } },
		expected: ["the driver confirms only the settings keys compaction and packages, not compaction.enabled"],
	},
	{
		name: "a context window given only through models is refused",
		asked: {
			contextWindow: undefined,
			scenarioModels: { prov: { modelOverrides: { mod: { contextWindow: 40_000 } } } },
		},
		expected: ["models sets a context window, which the driver confirms only as contextWindow"],
	},
	{
		name: "a context window in a provider's list of models is refused",
		asked: { contextWindow: undefined, scenarioModels: { prov: { models: [{ id: "mod", contextWindow: 40_000 }] } } },
		expected: ["models sets a context window, which the driver confirms only as contextWindow"],
	},
	{
		name: "a root with no core socket misses the run's core",
		loaded: { socket: Option.none() },
		expected: [`it starts delegates in no core, not the run's ${socket}`],
	},
	{
		name: "a package the root loaded an extension from is taken",
		asked: { setup: { settings: { compaction, packages: ["/r/phi-router"] } } },
		loaded: {
			settings: { compaction, packages: ["/r/phi-router"] },
			extensions: ["/r/phi-router/plugins/pi/extension.mjs"],
		},
		expected: [],
	},
	{
		name: "a package the root loaded nothing from is a miss, even when a sibling folder shares its prefix",
		asked: { setup: { settings: { compaction, packages: ["/r/phi-router"] } } },
		loaded: {
			settings: { compaction, packages: ["/r/phi-router"] },
			extensions: ["/r/phi-router-old/plugins/pi/extension.mjs"],
		},
		expected: ["it loaded no extension from the package /r/phi-router"],
	},
	{
		name: "a models.json error is the human's own when the setup sets no models",
		asked: { contextWindow: undefined, setup: {} },
		loaded: { modelsError: Option.some("bad providers") },
		expected: [],
	},
];

test.each(rows)("unmetOf: $name", (row) => {
	expect(unmetOf({ asked: { ...asked, ...row.asked }, loaded: { ...taken, ...row.loaded } })).toEqual([
		...row.expected,
	]);
});

test("unmetOf confirms a compaction exactly as pi's getCompactionSettings reads it", () => {
	const set = { enabled: false, reserveTokens: 1234, keepRecentTokens: 567 };
	const settings = { compaction: set };

	expect(unmetOf({ asked: { ...asked, setup: { settings } }, loaded: { ...taken, settings } })).toEqual([]);
	expect(SettingsManager.inMemory(settings).getCompactionSettings()).toEqual(set);
});

const took = (loaded: Option.Option<Loaded>) => {
	const sessions: Sessions = { root: { id: "s", file: "/s.jsonl", entries: [], loaded, requests: [] }, delegates: [] };

	return tookSetup(Effect.succeed(sessions), asked);
};

const afterTenSeconds = <Success, Failure>(taking: Effect.Effect<Success, Failure>) =>
	Effect.gen(function* () {
		const fiber = yield* Effect.forkChild(taking);

		yield* TestClock.adjust("10 seconds");

		return yield* Fiber.join(fiber);
	});

test("tookSetup: a root that took everything passes setup", () =>
	Effect.gen(function* () {
		const passed = yield* Option.some(taken).pipe(took, afterTenSeconds);

		expect(passed).toBeUndefined();
	}).pipe(Effect.provide(TestClock.layer()), Effect.runPromise));

test("tookSetup: a root that missed fails setup, naming each miss", () =>
	Effect.gen(function* () {
		const loaded: Loaded = { ...taken, model: "p/other", socket: Option.none() };
		const failure = yield* Option.some(loaded).pipe(took, Effect.flip, afterTenSeconds);

		expect(failure).toBeInstanceOf(SetupFailed);
		expect(failure.message).toBe(
			`the root did not take its setup: it runs p/other, not p/m; it starts delegates in no core, not the run's ${socket}`,
		);
	}).pipe(Effect.provide(TestClock.layer()), Effect.runPromise));

test("tookSetup: a root whose probe recorded nothing fails setup after 10 s", () =>
	Effect.gen(function* () {
		const failure = yield* Option.none<Loaded>().pipe(took, Effect.flip, afterTenSeconds);

		expect(failure).toBeInstanceOf(SetupFailed);
		expect(failure.message).toBe("the root's probe recorded nothing within 10 s");
	}).pipe(Effect.provide(TestClock.layer()), Effect.runPromise));
