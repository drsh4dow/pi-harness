import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { ScenarioFailed, SetupFailed } from "#tools/driver/failed.ts";
import { execIn, type Layout, modelsOf, type World } from "#tools/driver/world/index.ts";
import { type Root, startRoot } from "./root.ts";

export interface SpawnRequest {
	readonly name: string;
	readonly providers: Readonly<Record<string, Schema.JsonObject>>;
}

export interface Spawned extends Root {
	readonly project: string;
	readonly session: { readonly id: string; readonly file: string };
}

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.JsonObject));

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.JsonObject, { space: "\t" }));

const layoutIn = (run: Layout, name: string): Layout => {
	const folder = `${run.folder}/pis/${name}`;

	return {
		...run,
		agent: `${folder}/agent`,
		project: `${folder}/project`,
		sessions: `${folder}/sessions`,
		rpcIn: `${folder}/in.jsonl`,
		rpcOut: `${folder}/out.jsonl`,
		rootStderr: `${folder}/stderr`,
	};
};

const modelsFor = Effect.fn("modelsFor")(function* (run: Layout, providers: SpawnRequest["providers"]) {
	const fs = yield* FileSystem.FileSystem;
	const file = `${run.agent}/models.json`;
	const exists = yield* fs.exists(file);
	const read = Effect.asSome(Effect.flatMap(fs.readFileString(file), decodeJson));
	const theirs = yield* exists ? read : Effect.succeedNone;

	return yield* encodeJson(modelsOf({ human: theirs, providers }));
});

const agentFolder = Effect.fn("agentFolder")(function* (run: Layout, layout: Layout, request: SpawnRequest) {
	const fs = yield* FileSystem.FileSystem;
	const entries = yield* fs.readDirectory(run.agent);

	yield* Effect.forEach(
		Arr.filter(entries, (entry) => entry !== "models.json"),
		(entry) => fs.symlink(`${run.agent}/${entry}`, `${layout.agent}/${entry}`),
	);
	yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(`${layout.agent}/auth.json`)));

	const models = yield* modelsFor(run, request.providers);

	yield* fs.writeFileString(`${layout.agent}/models.json`, models);
});

const spawnedWorld = Effect.fn("spawnedWorld")(function* (world: World, request: SpawnRequest) {
	const fs = yield* FileSystem.FileSystem;
	const layout = layoutIn(world.layout, request.name);

	yield* Effect.forEach([layout.agent, layout.project, layout.sessions], (folder) =>
		fs.makeDirectory(folder, { recursive: true }),
	);
	yield* agentFolder(world.layout, layout, request);

	const env = { ...world.env, PI_CODING_AGENT_DIR: layout.agent };

	return { ...world, layout, env, exec: yield* execIn({ env, cwd: layout.project }) } satisfies World;
});

export const spawnIn = Effect.fn("spawnIn")(function* (world: World, model: string) {
	const fs = yield* FileSystem.FileSystem;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	return (request: SpawnRequest): Effect.Effect<Spawned, ScenarioFailed, Scope.Scope> =>
		spawnedWorld(world, request).pipe(
			Effect.flatMap((spawned) =>
				Effect.map(startRoot({ world: spawned, model, progress: () => Effect.void }), (started): Spawned => ({
					...started,
					project: spawned.layout.project,
				})),
			),
			Effect.catchTags({
				PlatformError: (error) => Effect.fail(SetupFailed.make({ message: error.message })),
				SchemaError: (error) => Effect.fail(SetupFailed.make({ message: error.message })),
			}),
			Effect.catchTag("SetupFailed", ({ message }) =>
				Effect.fail(ScenarioFailed.make({ message: `pi ${request.name} did not start: ${message}` })),
			),
			Effect.provideService(FileSystem.FileSystem, fs),
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
		);
});
