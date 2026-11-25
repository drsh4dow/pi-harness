import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schedule from "effect/Schedule";
import type * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type ScenarioFailed, SetupFailed } from "#tools/driver/failed.ts";
import type { Setup } from "#tools/driver/world/index.ts";
import { isJsonArray, type Loaded } from "./probe.ts";
import type { Sessions } from "./sessions.ts";

export interface AskedOfRoot {
	readonly model: string;
	readonly contextWindow?: number | undefined;
	readonly scenarioModels?: Setup["models"];
	readonly setup: Setup;
	readonly runCoreSocket: string;
}

const confirmable = new Set(["compaction.enabled", "compaction.reserveTokens", "compaction.keepRecentTokens"]);

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
	Predicate.isObject(value) && !isJsonArray(value);

const fieldsOf = ([key, value]: readonly [string, Schema.Json]) => {
	if (key !== "compaction") {
		return [];
	}

	return isJsonObject(value) && !Rec.isEmptyReadonlyRecord(value)
		? Arr.map(Rec.toEntries(value), ([field]) => `${key}.${field}`)
		: [key];
};

const confirmedKeys = new Set(["compaction", "packages"]);

const unloadedOf = (settings: Schema.JsonObject, extensions: ReadonlyArray<string>) => {
	const named = settings["packages"];
	const packages = named !== undefined && isJsonArray(named) ? Arr.filter(named, Predicate.isString) : [];

	return Arr.filter(packages, (folder) => !Arr.some(extensions, Str.startsWith(`${folder}/`)));
};

const setsWindow = (value: Schema.Json): boolean => {
	if (isJsonArray(value)) {
		return Arr.some(value, setsWindow);
	}

	return (
		isJsonObject(value) &&
		Arr.some(Rec.toEntries(value), ([key, field]) => key === "contextWindow" || setsWindow(field))
	);
};

export const unmetOf = ({ asked, loaded }: { readonly asked: AskedOfRoot; readonly loaded: Loaded }) => {
	const window = asked.contextWindow ?? loaded.contextWindow;
	const settings = Rec.toEntries(asked.setup.settings ?? {});
	const others = Arr.filter(settings, ([key]) => !confirmedKeys.has(key));
	const unloaded = unloadedOf(asked.setup.settings ?? {}, loaded.extensions);
	const unconfirmed = Arr.filter(Arr.flatMap(settings, fieldsOf), (path) => !confirmable.has(path));
	const missed = Arr.filter(settings, ([key, value]) => !Equal.equals(loaded.settings[key], value));
	const dropped = asked.setup.models === undefined ? Option.none() : loaded.modelsError;
	const windowInModels = Arr.some(Rec.values(asked.scenarioModels ?? {}), setsWindow);

	return [
		...(loaded.model === asked.model ? [] : [`it runs ${loaded.model}, not ${asked.model}`]),
		...(loaded.contextWindow === window
			? []
			: [`its context window is ${String(loaded.contextWindow)}, not ${String(window)}`]),
		...Arr.map(Option.toArray(dropped), (error) => `it dropped models.json: ${error}`),
		...Arr.map(missed, ([key]) => `its settings key ${key} is not the one set`),
		...Arr.map(unloaded, (folder) => `it loaded no extension from the package ${folder}`),
		...Arr.map(others, ([key]) => `the driver confirms only the settings keys compaction and packages, not ${key}`),
		...Arr.map(
			unconfirmed,
			(path) => `the driver cannot confirm the setting ${path}, only ${Arr.join([...confirmable], ", ")}`,
		),
		...(windowInModels ? ["models sets a context window, which the driver confirms only as contextWindow"] : []),
		...(Option.contains(loaded.socket, asked.runCoreSocket)
			? []
			: [
					`it starts delegates in ${Option.getOrElse(loaded.socket, () => "no core")}, not the run's ${asked.runCoreSocket}`,
				]),
	];
};

export const tookSetup = Effect.fn("tookSetup")(function* (
	sessions: Effect.Effect<Sessions, ScenarioFailed>,
	asked: AskedOfRoot,
) {
	const loaded = yield* sessions.pipe(
		Effect.flatMap(({ root }) => Effect.fromOption(root.loaded)),
		Effect.retry(Schedule.spaced("100 millis")),
		Effect.timeoutOrElse({
			duration: "10 seconds",
			orElse: () => Effect.fail(SetupFailed.make({ message: "the root's probe recorded nothing within 10 s" })),
		}),
	);

	const unmet = unmetOf({ asked, loaded });

	return Arr.isReadonlyArrayNonEmpty(unmet)
		? yield* SetupFailed.make({ message: `the root did not take its setup: ${Arr.join(unmet, "; ")}` })
		: undefined;
});
