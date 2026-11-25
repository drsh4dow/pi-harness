import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Order from "effect/Order";
import * as Str from "effect/String";

import { layoutOf } from "#tools/driver/world/index.ts";
import { leftAlone, strayed } from "./tripwire.ts";

const run = "leak-20260514-101010-42";
const core = "pi-driver-42-0abc12";

const written = [
	`.pi/agent/sessions/--tmp-pi-driver-${run}-${run}--/s.jsonl`,
	".pi/agent/sessions/--home-u-work--/other.jsonl",
	`.local/state/herdr-core/${core}/core.json`,
	`.local/state/pi-agent/${run}/work/STATE.md`,
	".local/state/pi-agent/work/run/STATE.md",
	".local/state/herdr-core/default/terminals.json",
];

const leaked = [
	`.local/state/herdr-core/${core}`,
	`.local/state/pi-agent/${run}`,
	`.pi/agent/sessions/--tmp-pi-driver-${run}-${run}--`,
];

const homeIn = (root: string, linked: boolean) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const state = linked ? `${root}/elsewhere` : `${root}/home/.local/state`;

		yield* fs.makeDirectory(`${root}/home/.local`, { recursive: true });
		yield* fs.makeDirectory(state, { recursive: true });
		yield* linked ? fs.symlink(state, `${root}/home/.local/state`) : Effect.void;
		yield* Effect.forEach(written, (file) =>
			Effect.andThen(
				fs.makeDirectory(`${root}/home/${Str.replace(/\/[^/]+$/u, "")(file)}`, { recursive: true }),
				fs.writeFileString(`${root}/home/${file}`, "x"),
			),
		);

		return `${root}/home`;
	});

const homes = [
	{ linked: false, where: "" },
	{ linked: true, where: ", under a linked state folder" },
];

test.each(homes)("strayed: names exactly what the run's names name$where", ({ linked }) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const home = yield* homeIn(root, linked);
			const found = yield* strayed({ home, names: [run, core] });
			const relative = Arr.map(found, Str.slice(home.length + 1));

			expect(Arr.sort(relative, Order.String)).toEqual(leaked);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);

const leftAloneRows = [
	{
		name: "names each working folder the wrapper refused",
		refused: "/home/u/work\n/srv/app\n",
		made: [`.local/state/herdr-core/${core}`],
		expected: ["SetupFailed", "outside its folder", "/home/u/work", "/srv/app"],
	},
	{
		name: "names each folder under the human's folders that holds the run's id or its core's session",
		refused: "",
		made: [
			`.local/state/herdr-core/${core}`,
			`.pi/agent/sessions/--tmp-pi-driver-${run}-${run}--`,
			".local/state/herdr-core/default",
		],
		expected: [
			"SetupFailed",
			`.local/state/herdr-core/${core}`,
			`.pi/agent/sessions/--tmp-pi-driver-${run}-${run}--`,
		],
	},
	{
		name: "passes a run that left the human's folders alone",
		refused: "",
		made: [".local/state/herdr-core/default", ".pi/agent/sessions/--home-u-work--"],
		expected: ["left alone"],
	},
];

test.each(leftAloneRows)("leftAlone: $name", ({ refused, made, expected }) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const layout = layoutOf({ tmp, name: "leak", stamp: "20260514-101010", pid: 42, tag: "0abc12" });
			const home = `${tmp}/human`;

			yield* fs.makeDirectory(layout.folder, { recursive: true });
			yield* fs.writeFileString(layout.refused, refused);
			yield* Effect.forEach(made, (folder) => fs.makeDirectory(`${home}/${folder}`, { recursive: true }));

			const config = ConfigProvider.fromUnknown({ HOME: home, PATH: Bun.env["PATH"] });

			const outcome = yield* leftAlone(layout).pipe(
				Effect.match({ onFailure: (error) => `${error._tag}: ${error.message}`, onSuccess: () => "left alone" }),
				Effect.provideService(ConfigProvider.ConfigProvider, config),
			);

			expect(Arr.filter(expected, (part) => !Str.includes(part)(outcome))).toEqual([]);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);
