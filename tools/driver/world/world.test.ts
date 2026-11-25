import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { modelsOf, type Setup, settingsOf, setupOf } from "./setup.ts";
import { layoutOf, openWorld, runEnv } from "./world.ts";

const layout = layoutOf({ tmp: "/t", name: "smoke", stamp: "20260514-101010", pid: 42, tag: "0abc12" });

const own = {
	PATH: "/repo/node_modules/.bin:/h/.pi/agent/bin:/h/.pi-worktrees/x/agent/bin:/usr/bin",
	HC_SESSION: "default",
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
	{ name: "the state folder follows the scratch home", key: "XDG_STATE_HOME" },
	{ name: "the config folder follows the scratch home", key: "XDG_CONFIG_HOME" },
	{ name: "an unset key stays unset", key: "UNSET" },
] as const;

test.each(unsetRows)("runEnv: $name", ({ key }) => {
	expect(env).not.toHaveProperty(key);
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

const opened = (setup: Setup) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
		const human = ConfigProvider.fromUnknown({ HOME: `${tmp}/human`, XDG_RUNTIME_DIR: `${tmp}/runtime` });

		yield* fs.makeDirectory(`${tmp}/pi-driver`);
		yield* fs.makeDirectory(`${tmp}/fake`);
		yield* fs.writeFileString(`${tmp}/fake/pi`, "#!/bin/sh\necho 0.0.0\n", { mode: 0o755 });

		return yield* openWorld({
			layout: layoutOf({ tmp, name: "world", stamp: "t", pid: process.pid, tag: "0abc12" }),
			setup,
			own: { PATH: `${tmp}/fake:${Bun.env["PATH"] ?? ""}` },
		}).pipe(Effect.provideService(ConfigProvider.ConfigProvider, human));
	});

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const readJson = Effect.fn("readJson")(function* (path: string) {
	const fs = yield* FileSystem.FileSystem;
	const text = yield* fs.readFileString(path);

	return yield* decodeJson(text);
});

const noCore = Bun.which("herdr-core") === null;

test.skipIf(noCore)("openWorld writes the setup's settings and models into the run's agent folder", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const world = yield* opened({ settings: { compaction: { enabled: false } }, models: { "ultra-a": override } });
			const settings = yield* readJson(`${world.layout.agent}/settings.json`);
			const models = yield* readJson(`${world.layout.agent}/models.json`);

			expect({ settings, models }).toEqual({
				settings: { compaction: { enabled: false } },
				models: { providers: { "ultra-a": override } },
			});
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);

test.skipIf(noCore)("openWorld writes a setup file under HOME by its path, owner-only, in owner-only folders", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const world = yield* opened({ files: ({ home }) => ({ ".config/phi-router/config.json": { home } }) });
			const config = `${world.layout.home}/.config`;
			const file = `${config}/phi-router/config.json`;
			const json = yield* readJson(file);

			const modes = yield* Effect.forEach([config, `${config}/phi-router`, file], (path) =>
				Effect.map(fs.stat(path), ({ mode }) => mode % 0o1000),
			);

			expect({ json, modes }).toEqual({
				json: { home: world.layout.home },
				modes: [0o700, 0o700, 0o600],
			});
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);
