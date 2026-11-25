import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";
import { layoutOf, type World } from "#tools/driver/world/index.ts";
import { spawnIn } from "./spawn.ts";

const fakePi = `#!/usr/bin/env bun
const seen = { argv: process.argv.slice(2), agentDir: process.env.PI_CODING_AGENT_DIR, home: process.env.HOME };
console.error(JSON.stringify(seen));
for await (const line of console) {
	if (line === "") continue;
	const { id } = JSON.parse(line);
	const data = { sessionId: "s", sessionFile: "/s.jsonl" };
	console.log(JSON.stringify({ type: "response", id, success: true, data }));
}
`;

const fakeRun = (agentFiles: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tmp = yield* fs.makeTempDirectoryScoped();
		const layout = layoutOf({ tmp, name: "fake", stamp: "20260514-101010", pid: 42, tag: "0abc12" });

		yield* Effect.forEach([layout.bin, layout.agent], (dir) => fs.makeDirectory(dir, { recursive: true }));
		yield* fs.writeFileString(`${layout.bin}/pi`, fakePi, { mode: 0o755 });
		yield* Effect.forEach(Rec.toEntries(agentFiles), ([name, text]) =>
			fs.writeFileString(`${layout.agent}/${name}`, text),
		);

		return {
			layout,
			agentDir: tmp,
			env: { PATH: Bun.env["PATH"] ?? "", HOME: layout.home },
			pi: { version: "0.0.0", path: `${layout.bin}/pi` },
			exec: () => Effect.die("unused"),
		} satisfies World;
	});

const run = <Value, Failure>(
	effect: Effect.Effect<Value, Failure, Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>,
) => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

test("run.spawn starts a pi on the run's model and env, in its own folders under <run>/pis/<name>", () =>
	run(
		Effect.gen(function* () {
			const world = yield* fakeRun({ "settings.json": "{}", "auth.json": "{}" });
			const spawn = yield* spawnIn(world, "a/b");
			const pis = `${world.layout.folder}/pis/a`;

			const spawned = yield* spawn({ name: "a", providers: {} });

			yield* eventually(Effect.map(spawned.stderr, Str.isNonEmpty), "5 seconds");

			const seen = yield* Effect.flatMap(spawned.stderr, decodeJson);

			expect(seen).toEqual({
				argv: ["--mode", "rpc", "--model", "a/b", "--session-dir", `${pis}/sessions`],
				agentDir: `${pis}/agent`,
				home: world.layout.home,
			});
			expect(spawned.project).toBe(`${pis}/project`);
		}),
	));

test("a spawned pi's agent folder links the run's entries but models.json, and drops auth.json when its scope closes", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const runModels = '{"providers":{"kept":{"baseUrl":"k"}}}';
			const world = yield* fakeRun({ "settings.json": "{}", "auth.json": "{}", "models.json": runModels });
			const spawn = yield* spawnIn(world, "a/b");
			const agent = `${world.layout.folder}/pis/a/agent`;

			const linked = yield* Effect.scoped(
				Effect.andThen(spawn({ name: "a", providers: { swapped: { baseUrl: "new" } } }), () =>
					Effect.all([fs.readLink(`${agent}/settings.json`), fs.readLink(`${agent}/auth.json`)]),
				),
			);

			const authLeft = yield* fs.exists(`${agent}/auth.json`);
			const runModelsAfter = yield* fs.readFileString(`${world.layout.agent}/models.json`);

			expect(linked).toEqual([`${world.layout.agent}/settings.json`, `${world.layout.agent}/auth.json`]);
			expect(authLeft).toBe(false);
			expect(runModelsAfter).toBe(runModels);
		}),
	));

test.each([
	{
		name: "the run's with the given providers replaced",
		agentFiles: { "models.json": '{"providers":{"kept":{"baseUrl":"k"},"swapped":{"baseUrl":"old"}}}' },
		expected: { providers: { kept: { baseUrl: "k" }, swapped: { baseUrl: "new" } } },
	},
	{
		name: "only the given providers when the run has none",
		agentFiles: {},
		expected: { providers: { swapped: { baseUrl: "new" } } },
	},
])("a spawned pi's models.json is $name", ({ agentFiles, expected }) =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const world = yield* fakeRun(agentFiles);
			const spawn = yield* spawnIn(world, "a/b");

			yield* spawn({ name: "a", providers: { swapped: { baseUrl: "new" } } });

			const models = yield* fs.readFileString(`${world.layout.folder}/pis/a/agent/models.json`);
			const decoded = yield* decodeJson(models);

			expect(decoded).toEqual(expected);
		}),
	),
);
