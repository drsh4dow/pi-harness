import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

import { type ScenarioFailed, SetupFailed } from "#tools/driver/failed.ts";
import { harnessEntries, withoutPackageBins } from "#tools/harness.ts";
import { type Argv, execIn, type Exited, ran, startCore } from "./core.ts";
import { modelsOf, type RunSetup, settingsOf } from "./setup.ts";

type Env = Readonly<Record<string, string>>;

export interface Layout {
	readonly id: string;
	readonly folder: string;
	readonly home: string;
	readonly agent: string;
	readonly bin: string;
	readonly refused: string;
	/** `PI_DRIVER_PROBE`: one JSON lines file per pi process. */
	readonly probe: string;
	readonly project: string;
	readonly sessions: string;
	readonly coreSession: string;
	readonly runtime: string;
	readonly socket: string;
	readonly report: string;
	readonly rpcIn: string;
	readonly rpcOut: string;
	readonly rootStderr: string;
	readonly coreLog: string;
}

export const layoutOf = (run: {
	readonly tmp: string;
	readonly name: string;
	readonly stamp: string;
	readonly pid: number;
	readonly tag: string;
}): Layout => {
	const id = `${run.name}-${run.stamp}-${String(run.pid)}`;
	const folder = `${run.tmp}/pi-driver/${id}`;
	const coreSession = `pi-driver-${String(run.pid)}-${run.tag}`;
	const runtime = `${run.tmp}/pi-driver/${coreSession}`;

	return {
		id,
		folder,
		home: `${folder}/home`,
		agent: `${folder}/home/.pi/agent`,
		bin: `${folder}/bin`,
		refused: `${folder}/refused.txt`,
		probe: `${folder}/probe`,
		project: `${folder}/${id}`,
		sessions: `${folder}/sessions`,
		coreSession,
		runtime,
		socket: `${runtime}/herdr-core/${coreSession}.sock`,
		report: `${folder}/report.txt`,
		rpcIn: `${folder}/root.in.jsonl`,
		rpcOut: `${folder}/root.out.jsonl`,
		rootStderr: `${folder}/root.stderr`,
		coreLog: `${folder}/core.log`,
	};
};

const followsHome = new Set(["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]);

export const runEnv = ({
	own,
	humanHome,
	layout,
	borrowed,
}: {
	readonly own: Readonly<Record<string, string | undefined>>;
	readonly humanHome: string;
	readonly layout: Layout;
	readonly borrowed: Env;
}) => {
	const kept = Rec.filterMap(own, (value, key) =>
		value === undefined || /^(?:HC|PI)_/u.test(key) || followsHome.has(key) ? Result.failVoid : Result.succeed(value),
	);

	const isLiveHarness = (folder: string) =>
		folder === `${humanHome}/.pi` || Str.startsWith(`${humanHome}/.pi/`)(folder);

	const path = Arr.filter(Str.split(withoutPackageBins(kept).PATH, ":"), (folder) => !isLiveHarness(folder));

	return {
		...kept,
		...borrowed,
		PATH: Arr.join([layout.bin, ...path], ":"),
		HOME: layout.home,
		PI_CODING_AGENT_DIR: layout.agent,
		PI_DRIVER_PROBE: layout.probe,
		XDG_RUNTIME_DIR: layout.runtime,
		HC_SESSION: layout.coreSession,
		HC_SOCKET: layout.socket,
		HC_TERMINAL_SOCKET: layout.socket,
	};
};

export interface World {
	readonly layout: Layout;
	readonly agentDir: string;
	readonly env: Env;
	readonly pi: { readonly version: string; readonly path: string };
	readonly exec: (argv: Argv) => Effect.Effect<Exited, ScenarioFailed>;
}

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.JsonObject));

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.JsonObject, { space: "\t" }));

const worktree = Str.replace(/\/tools\/driver\/world$/u, "")(import.meta.dirname);

const linkAgent = Effect.fn("linkAgent")(function* (layout: Layout, humanAgent: string) {
	const fs = yield* FileSystem.FileSystem;
	const gitignore = yield* fs.readFileString(`${worktree}/.gitignore`);
	const shipped = yield* Effect.filter(harnessEntries(gitignore), (entry) => fs.exists(`${worktree}/agent/${entry}`));

	yield* Effect.forEach(shipped, (entry) => fs.symlink(`${worktree}/agent/${entry}`, `${layout.agent}/${entry}`));
	yield* fs.symlink(`${humanAgent}/auth.json`, `${layout.agent}/auth.json`);
	yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(`${layout.agent}/auth.json`)));

	if (yield* fs.exists(`${humanAgent}/models-store.json`)) {
		yield* fs.copyFile(`${humanAgent}/models-store.json`, `${layout.agent}/models-store.json`);
	}
});

const writeConfig = Effect.fn("writeConfig")(function* (layout: Layout, setup: RunSetup, humanAgent: string) {
	const fs = yield* FileSystem.FileSystem;

	const readHuman = (file: string) =>
		Effect.flatMap(fs.exists(`${humanAgent}/${file}`), (exists) =>
			exists
				? Effect.asSome(Effect.flatMap(fs.readFileString(`${humanAgent}/${file}`), decodeJson))
				: Effect.succeedNone,
		);

	const humanSettings = yield* readHuman("settings.json");
	const humanModels = yield* readHuman("models.json");

	const settings = yield* encodeJson(
		settingsOf({ human: Option.getOrElse(humanSettings, () => ({})), overrides: setup.settings ?? {} }),
	);

	yield* fs.writeFileString(`${layout.agent}/settings.json`, settings);

	if (Option.isNone(humanModels) && setup.models === undefined) {
		return;
	}

	const models = yield* encodeJson(
		modelsOf({ human: humanModels, providers: setup.models ?? {}, windowed: setup.windowed }),
	);

	yield* fs.writeFileString(`${layout.agent}/models.json`, models);
});

const writeFiles = Effect.fn("writeFiles")(function* (layout: Layout, setup: RunSetup) {
	const fs = yield* FileSystem.FileSystem;

	yield* Effect.forEach(Rec.toEntries(setup.files?.(layout) ?? {}), ([file, json]) =>
		Effect.gen(function* () {
			const path = `${layout.home}/${file}`;
			const text = yield* encodeJson(json);

			yield* fs.makeDirectory(Str.replace(/\/[^/]*$/u, "")(path), { recursive: true, mode: 0o700 });
			yield* fs.writeFileString(path, text, { mode: 0o600 });
		}),
	);
});

const resolvePi = Effect.fn("resolvePi")(function* (layout: Layout, env: Env) {
	const fs = yield* FileSystem.FileSystem;
	const found = yield* ran({ argv: ["sh", "-c", "command -v pi"], env, cwd: layout.folder });

	if (found.code !== 0) {
		return yield* SetupFailed.make({ message: "no pi on PATH" });
	}

	const path = yield* fs.realPath(Str.trim(found.output));
	const version = yield* ran({ argv: [path, "--version"], env, cwd: layout.folder });
	const folder = yield* fs.realPath(layout.folder);

	const wrapper = `#!/bin/sh
case "$(pwd -P)/" in '${folder}'/*) exec '${path}' -e '${worktree}/tools/driver/sessions/probe.ts' "$@" ;; esac
pwd -P >>'${layout.refused}'
echo "pi starts only inside the run folder ${folder}, not in $(pwd -P)" >&2
exit 2
`;

	yield* fs.writeFileString(`${layout.bin}/pi`, wrapper, { mode: 0o755 });

	return { version: Str.trim(version.output), path };
});

type Needs = Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

const envOf = Effect.fn("envOf")(function* (layout: Layout, own: Readonly<Record<string, string | undefined>>) {
	const fs = yield* FileSystem.FileSystem;
	const humanHome = yield* Config.String("HOME");
	const humanRuntime = yield* Config.String("XDG_RUNTIME_DIR");
	const borrowable = { GIT_CONFIG_GLOBAL: `${humanHome}/.gitconfig`, GH_CONFIG_DIR: `${humanHome}/.config/gh` };
	const borrowed = yield* Effect.filter(Rec.toEntries(borrowable), ([, file]) => fs.exists(file));

	yield* fs.makeDirectory(layout.runtime, { mode: 0o700 });
	yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(layout.runtime, { recursive: true })));
	yield* fs.symlink(`${humanRuntime}/systemd`, `${layout.runtime}/systemd`);

	return { humanHome, env: runEnv({ own, humanHome, layout, borrowed: Rec.fromEntries(borrowed) }) };
});

export const openWorld = (input: {
	readonly layout: Layout;
	readonly setup: RunSetup;
	readonly own: Readonly<Record<string, string | undefined>>;
}): Effect.Effect<World, SetupFailed, Needs> =>
	Effect.gen(function* () {
		const { layout } = input;
		const fs = yield* FileSystem.FileSystem;
		const { humanHome, env } = yield* envOf(layout, input.own);

		yield* Effect.forEach([layout.agent, layout.bin, layout.probe, layout.project, layout.sessions], (folder) =>
			fs.makeDirectory(folder, { recursive: true }),
		);

		const pi = yield* resolvePi(layout, env);

		yield* startCore({ layout, env });
		yield* linkAgent(layout, `${humanHome}/.pi/agent`);
		yield* writeConfig(layout, input.setup, `${humanHome}/.pi/agent`);
		yield* writeFiles(layout, input.setup);

		return { layout, agentDir: `${worktree}/agent`, env, pi, exec: yield* execIn({ env, cwd: layout.project }) };
	}).pipe(
		Effect.catchTags({
			PlatformError: (error) => Effect.fail(SetupFailed.make({ message: error.message })),
			SchemaError: (error) =>
				Effect.fail(SetupFailed.make({ message: `a JSON file did not parse: ${error.message}` })),
			ConfigError: (error) => Effect.fail(SetupFailed.make({ message: error.message })),
		}),
	);
