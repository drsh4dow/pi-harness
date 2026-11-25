import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

import { startRoot } from "#tools/driver/run/index.ts";
import { modelsOf, type RunSetup, settingsOf, setupOf } from "./setup.ts";
import { layoutOf, openWorld, runEnv, type World } from "./world.ts";

const layout = layoutOf({ tmp: "/t", name: "smoke", stamp: "20260514-101010", pid: 42, tag: "0abc12" });

const own = {
	PATH: "/repo/node_modules/.bin:/h/.pi/agent/bin:/h/.pi-worktrees/x/agent/bin:/usr/bin",
	HC_SESSION: "default",
	HC_PANE_ID: "p1",
	PI_OWNED_WORK_SLICE: "parent",
	XDG_STATE_HOME: "/h/.local/state",
	XDG_CONFIG_HOME: "/h/.config",
	XDG_RUNTIME_DIR: "/run/user/1000",
	LANG: "C.UTF-8",
	UNSET: undefined,
};

const env = runEnv({ own, humanHome: "/h", layout, borrowed: { GIT_CONFIG_GLOBAL: "/h/.gitconfig" } });

const setRows = [
	{
		name: "PATH starts with the wrapper, without package bins or the live harness",
		key: "PATH",
		value: `${layout.bin}:/h/.pi-worktrees/x/agent/bin:/usr/bin`,
	},
	{ name: "HOME is the scratch home", key: "HOME", value: "/t/pi-driver/smoke-20260514-101010-42/home" },
	{
		name: "the agent folder is the scratch home's",
		key: "PI_CODING_AGENT_DIR",
		value: "/t/pi-driver/smoke-20260514-101010-42/home/.pi/agent",
	},
	{ name: "the core session replaces the caller's", key: "HC_SESSION", value: "pi-driver-42-0abc12" },
	{
		name: "the hc CLI reaches the run's core",
		key: "HC_SOCKET",
		value: "/t/pi-driver/pi-driver-42-0abc12/herdr-core/pi-driver-42-0abc12.sock",
	},
	{ name: "owned-work reaches the run's core", key: "HC_TERMINAL_SOCKET", value: layout.socket },
	{ name: "the probe writes into the run", key: "PI_DRIVER_PROBE", value: layout.probe },
	{ name: "the runtime folder is the run's", key: "XDG_RUNTIME_DIR", value: layout.runtime },
	{ name: "other keys stay", key: "LANG", value: "C.UTF-8" },
	{ name: "borrowed config is added", key: "GIT_CONFIG_GLOBAL", value: "/h/.gitconfig" },
] as const;

test.each(setRows)("runEnv: $name", ({ key, value }) => {
	expect(env).toHaveProperty(key, value);
});

const unsetRows = [
	{ name: "the caller's slice is dropped", key: "PI_OWNED_WORK_SLICE" },
	{ name: "the caller's hc keys are dropped", key: "HC_PANE_ID" },
	{ name: "the state folder follows the scratch home", key: "XDG_STATE_HOME" },
	{ name: "the config folder follows the scratch home", key: "XDG_CONFIG_HOME" },
	{ name: "an unset key stays unset", key: "UNSET" },
] as const;

test.each(unsetRows)("runEnv: $name", ({ key }) => {
	expect(env).not.toHaveProperty(key);
});

test("layoutOf: a reused pid gets another core session under another tag", () => {
	const again = layoutOf({ tmp: "/t", name: "smoke", stamp: "20260514-101010", pid: 42, tag: "0def34" });

	expect(again.coreSession).not.toBe(layout.coreSession);
});

test("layoutOf: the project folder is named for the run id, so a state folder named for it is the run's", () => {
	expect(layout.project).toStartWith(`${layout.folder}/`);
	expect(layout.project).toEndWith(`/${layout.id}`);
});

const settingsRows = [
	{
		name: "resource keys are dropped so the live harness never loads",
		human: {
			packages: ["npm:x"],
			extensions: ["/h/.pi/agent/x.ts"],
			skills: [],
			prompts: [],
			themes: [],
			theme: "dark",
		},
		overrides: {},
		expected: { theme: "dark" },
	},
	{
		name: "an override replaces the whole top-level key",
		human: { compaction: { enabled: false, reserveTokens: 1 }, theme: "dark" },
		overrides: { compaction: { enabled: true } },
		expected: { compaction: { enabled: true }, theme: "dark" },
	},
	{
		name: "an override may set a resource key the human had",
		human: { extensions: ["/h/x.ts"] },
		overrides: { extensions: ["/w/y.ts"] },
		expected: { extensions: ["/w/y.ts"] },
	},
] as const;

test.each(settingsRows)("settingsOf: $name", ({ human, overrides, expected }) => {
	expect(settingsOf({ human, overrides })).toEqual(expected);
});

const override = { modelOverrides: { "claude-fable-5-2": { contextWindow: 40_000 } } };

const modelsRows = [
	{
		name: "with no human file, the setup starts one",
		human: Option.none(),
		providers: { "ultra-a": override },
		expected: { providers: { "ultra-a": override } },
	},
	{
		name: "a setup provider replaces the human's of that name and keeps the rest",
		human: Option.some({ providers: { "ultra-a": { apiKey: "k" }, local: { baseUrl: "http://l" } }, other: 1 }),
		providers: { "ultra-a": override },
		expected: { providers: { "ultra-a": override, local: { baseUrl: "http://l" } }, other: 1 },
	},
	{
		name: "with no setup providers, the human's file is copied",
		human: Option.some({ providers: { local: { baseUrl: "http://l" } } }),
		providers: {},
		expected: { providers: { local: { baseUrl: "http://l" } } },
	},
] as const;

test.each(modelsRows)("modelsOf: $name", ({ human, providers, expected }) => {
	expect(modelsOf({ human, providers })).toEqual(expected);
});

const { models: windowedProviders = {}, windowed } = setupOf({ model: "local/big", contextWindow: 40_000 });

test("modelsOf: contextWindow's override merges into the human's custom provider, keeping its models", () => {
	const local = { baseUrl: "http://l", models: [{ id: "big" }], modelOverrides: { big: { maxTokens: 1 } } };

	expect(
		modelsOf({
			human: Option.some({ providers: { local } }),
			providers: windowedProviders,
			windowed,
		}),
	).toEqual({ providers: { local: { ...local, modelOverrides: { big: { maxTokens: 1, contextWindow: 40_000 } } } } });
});

const path = Bun.env["PATH"] ?? "";

const fakePi = `#!/usr/bin/env bun
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
	console.log(" 9.9.9 ");
} else {
	console.log(JSON.stringify({ argv, cwd: process.cwd() }));
	const sessionDir = argv[argv.indexOf("--session-dir") + 1];
	for await (const line of console) {
		const { id } = JSON.parse(line);
		const data = { sessionId: process.cwd(), sessionFile: sessionDir };
		console.log(JSON.stringify({ type: "response", id, success: true, data }));
	}
}
`;

const fakeCore = `#!/bin/sh
echo $$ >"$FAKE_CORE_PID"
mkdir -p "$(dirname "$HC_SOCKET")" && : >"$HC_SOCKET"
exec sleep 600
`;

const fakesIn = Effect.fn("fakesIn")(function* (tmp: string) {
	const fs = yield* FileSystem.FileSystem;

	yield* Effect.forEach([`${tmp}/human/.pi/agent`, `${tmp}/fakes`, `${tmp}/real`, `${tmp}/pi-driver`], (folder) =>
		fs.makeDirectory(folder, { recursive: true }),
	);
	yield* fs.writeFileString(`${tmp}/human/.pi/agent/auth.json`, "{}");
	yield* fs.writeFileString(`${tmp}/human/.gitconfig`, "");
	yield* fs.writeFileString(`${tmp}/real/pi`, fakePi, { mode: 0o755 });
	yield* fs.symlink(`${tmp}/real/pi`, `${tmp}/fakes/pi`);
	yield* fs.writeFileString(`${tmp}/fakes/herdr-core`, fakeCore, { mode: 0o755 });
	yield* fs.writeFileString(`${tmp}/fakes/hc`, "#!/bin/sh\n", { mode: 0o755 });
});

type Needs = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;

const inWorld = <Value, Failure>(input: {
	readonly setup?: RunSetup;
	readonly during: (world: World) => Effect.Effect<Value, Failure, Needs>;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
		const humanEnv = ConfigProvider.fromUnknown({ HOME: `${tmp}/human`, XDG_RUNTIME_DIR: `${tmp}/human-run` });

		yield* fakesIn(tmp);

		const opened = Effect.gen(function* () {
			const world = yield* openWorld({
				layout: layoutOf({ tmp, name: "world", stamp: "t", pid: process.pid, tag: "0abc12" }),
				setup: input.setup ?? {},
				own: { PATH: `${tmp}/fakes:${path}`, FAKE_CORE_PID: `${tmp}/core.pid` },
			}).pipe(Effect.provideService(ConfigProvider.ConfigProvider, humanEnv));

			return { world, seen: yield* input.during(world) };
		});

		return { ...(yield* Effect.scoped(opened)), tmp };
	});

const run = <Value, Failure>(effect: Effect.Effect<Value, Failure, Needs>) =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

test("openWorld: the agent folder links into agentDir, but auth.json, which links to the human's", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const { seen, world, tmp } = yield* inWorld({
				during: ({ layout: { agent } }) =>
					Effect.flatMap(fs.readDirectory(agent), (names) =>
						Effect.forEach(names, (name) =>
							Effect.map(Effect.option(fs.readLink(`${agent}/${name}`)), (target) => [name, target] as const),
						),
					),
			});

			const links = Rec.getSomes(Rec.fromEntries(seen));
			const { "auth.json": auth, ...shipped } = links;

			expect(auth).toBe(`${tmp}/human/.pi/agent/auth.json`);
			expect(shipped["extensions"]).toBe(`${world.agentDir}/extensions`);
			expect(Arr.filter(Rec.values(shipped), (target) => !Str.startsWith(`${world.agentDir}/`)(target))).toEqual([]);
		}),
	));

test("openWorld: closing the world removes the auth.json link and runtime folder and stops the core, keeping the rest", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const { world, tmp } = yield* inWorld({ during: () => Effect.void });
			const core = yield* Effect.map(fs.readFileString(`${tmp}/core.pid`), Number);

			const after = yield* Effect.all({
				link: fs.exists(`${world.layout.agent}/auth.json`),
				humanAuth: fs.exists(`${tmp}/human/.pi/agent/auth.json`),
				runtime: fs.exists(world.layout.runtime),
				folder: fs.exists(world.layout.folder),
			});

			expect({ ...after, core: isAlive(core) }).toEqual({
				link: false,
				humanAuth: true,
				runtime: false,
				folder: true,
				core: false,
			});
		}),
	));

test("openWorld: pi is the real path of the pi on the run's PATH, with its version", () =>
	run(
		Effect.gen(function* () {
			const { world, tmp } = yield* inWorld({ during: () => Effect.void });

			expect(world.pi).toEqual({ version: "9.9.9", path: `${tmp}/real/pi` });
		}),
	));

test("openWorld: pi in the run folder runs the real pi with the probe", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const probe = Str.replace(/\/world$/u, "/sessions/probe.ts")(import.meta.dirname);

			const { seen } = yield* inWorld({
				during: ({ exec, layout: { project } }) =>
					Effect.all({ ran: exec(["pi", "a"]), cwd: fs.realPath(project) }),
			});

			expect(seen.ran).toEqual({ code: 0, output: `{"argv":["-e","${probe}","a"],"cwd":"${seen.cwd}"}\n` });
		}),
	));

test("openWorld: pi outside the run folder exits 2 without starting, and each refused folder is a line", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const { seen, world } = yield* inWorld({
				during: ({ exec }) =>
					Effect.forEach(["/", "/tmp"], (outside) =>
						Effect.map(exec(["sh", "-c", 'cd "$1" && pi a', "sh", outside]), ({ code, output }) => ({
							code,
							started: Str.includes('"argv"')(output),
						})),
					),
			});

			const refused = yield* fs.readFileString(world.layout.refused);

			expect(seen).toEqual([
				{ code: 2, started: false },
				{ code: 2, started: false },
			]);
			expect(refused).toBe("/\n/tmp\n");
		}),
	));

test("openWorld: the project folder is empty, and the root starts in it with the sessions folder as its session dir", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const { seen } = yield* inWorld({
				during: (world) =>
					Effect.gen(function* () {
						const before = yield* fs.readDirectory(world.layout.project);
						const root = yield* startRoot({ world, model: "a/b", progress: () => Effect.void });

						return { before, session: root.session, project: yield* fs.realPath(world.layout.project), world };
					}),
			});

			expect(seen.before).toEqual([]);
			expect(seen.session).toEqual({ id: seen.project, file: seen.world.layout.sessions });
		}),
	));

test("openWorld: the run borrows only the human's git and gh config that exist, and links their systemd folder", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const { seen, world, tmp } = yield* inWorld({
				during: ({ layout: { runtime } }) => fs.readLink(`${runtime}/systemd`),
			});

			expect(world.env["GIT_CONFIG_GLOBAL"]).toBe(`${tmp}/human/.gitconfig`);
			expect(world.env).not.toHaveProperty("GH_CONFIG_DIR");
			expect(seen).toBe(`${tmp}/human-run/systemd`);
		}),
	));

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const readJson = Effect.fn("readJson")(function* (file: string) {
	const fs = yield* FileSystem.FileSystem;

	const text = yield* fs.readFileString(file);

	return yield* decodeJson(text);
});

test("openWorld: the setup's settings and models land in the run's agent folder", () =>
	run(
		Effect.gen(function* () {
			const { seen } = yield* inWorld({
				setup: { settings: { compaction: { enabled: false } }, models: { "ultra-a": override } },
				during: ({ layout: { agent } }) =>
					Effect.all({ settings: readJson(`${agent}/settings.json`), models: readJson(`${agent}/models.json`) }),
			});

			expect(seen).toEqual({
				settings: { compaction: { enabled: false } },
				models: { providers: { "ultra-a": override } },
			});
		}),
	));

const configRows = [
	{ name: "no models.json when neither the human nor the setup has one", setup: {}, models: false },
	{ name: "models.json when the setup has one", setup: { models: { local: { baseUrl: "http://l" } } }, models: true },
] as const;

test.each(configRows)("openWorld: settings.json, and $name", ({ setup, models }) =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			const { seen } = yield* inWorld({
				setup,
				during: ({ layout: { agent } }) =>
					Effect.all({ settings: fs.exists(`${agent}/settings.json`), models: fs.exists(`${agent}/models.json`) }),
			});

			expect(seen).toEqual({ settings: true, models });
		}),
	),
);

test("openWorld: a setup file lands under HOME by its path, owner-only, in owner-only folders", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const modeOf = (file: string) => Effect.map(fs.stat(file), ({ mode }) => mode.toString(8));

			const { seen, world } = yield* inWorld({
				setup: { files: ({ home }) => ({ ".config/fake/config.json": { home } }) },
				during: ({ layout: { home } }) =>
					Effect.all({
						json: readJson(`${home}/.config/fake/config.json`),
						modes: Effect.all([
							modeOf(`${home}/.config`),
							modeOf(`${home}/.config/fake`),
							modeOf(`${home}/.config/fake/config.json`),
						]),
					}),
			});

			expect(seen).toEqual({ json: { home: world.layout.home }, modes: ["40700", "40700", "100600"] });
		}),
	));
