import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

import { SetupFailed } from "#tools/driver/failed.ts";
import { type Layout, ran } from "#tools/driver/world/index.ts";

type Names = readonly [string, ...Array<string>];

const holdingAny = ([first, ...rest]: Names) => [
	"(",
	"-name",
	`*${first}*`,
	...Arr.flatMap(rest, (name) => ["-o", "-name", `*${name}*`]),
	")",
];

export const guardedFolders = (home: string) => [`${home}/.pi/agent/sessions`, `${home}/.local/state`];

export const strayed = Effect.fn("strayed")(function* (input: { readonly home: string; readonly names: Names }) {
	const fs = yield* FileSystem.FileSystem;
	const roots = yield* Effect.filter(guardedFolders(input.home), (folder) => fs.exists(folder));

	if (Arr.isReadonlyArrayEmpty(roots)) {
		return [];
	}

	const env = { PATH: yield* Config.String("PATH") };
	const found = yield* ran({ argv: ["find", "-H", ...roots, ...holdingAny(input.names), "-print"], env, cwd: "/" });

	if (found.code !== 0) {
		return yield* SetupFailed.make({ message: `the tripwire could not list your folders: ${found.output}` });
	}

	return Arr.filter(Str.split(found.output, "\n"), Str.isNonEmpty);
});

export const leftAlone = Effect.fn("leftAlone")(
	function* (layout: Layout) {
		const fs = yield* FileSystem.FileSystem;
		const refused = (yield* fs.exists(layout.refused)) ? yield* fs.readFileString(layout.refused) : "";
		const outside = Arr.filter(Str.split(refused, "\n"), Str.isNonEmpty);

		if (Arr.isReadonlyArrayNonEmpty(outside)) {
			return yield* SetupFailed.make({
				message: `the run started pi outside its folder: ${Arr.join(outside, " ")}`,
			});
		}

		const home = yield* Config.String("HOME");
		const leaked = yield* strayed({ home, names: [layout.id, layout.coreSession] });

		return Arr.isReadonlyArrayNonEmpty(leaked)
			? yield* SetupFailed.make({ message: `the run wrote under your folders: ${Arr.join(leaked, " ")}` })
			: undefined;
	},
	Effect.catchTags({
		PlatformError: (error) => Effect.fail(SetupFailed.make({ message: `the tripwire failed: ${error.message}` })),
		ConfigError: (error) => Effect.fail(SetupFailed.make({ message: `the tripwire failed: ${error.message}` })),
	}),
);
