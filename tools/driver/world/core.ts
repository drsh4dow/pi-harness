import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { ScenarioFailed, SetupFailed } from "#tools/driver/failed.ts";
import type { Layout } from "./world.ts";

export type Argv = readonly [string, ...Array<string>];

type Env = Readonly<Record<string, string>>;

export interface Exited {
	readonly code: number;
	readonly output: string;
}

export const ran = Effect.fn("ran")(function* (command: {
	readonly argv: Argv;
	readonly env: Env;
	readonly cwd: string;
}) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const [program, ...args] = command.argv;

	const handle = yield* spawner.spawn(
		ChildProcess.make(program, args, {
			cwd: command.cwd,
			env: command.env,
			stdin: "ignore",
			detached: false,
			forceKillAfter: "2 seconds",
		}),
	);

	return yield* Effect.all(
		{ code: handle.exitCode, output: handle.all.pipe(Stream.decodeText, Stream.mkString) },
		{ concurrency: 2 },
	);
}, Effect.scoped);

export const execIn = Effect.fn("execIn")(function* (place: { readonly env: Env; readonly cwd: string }) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	return (argv: Argv) =>
		ran({ argv, ...place }).pipe(
			Effect.timeoutOrElse({
				duration: "1 minute",
				orElse: () => Effect.fail(ScenarioFailed.make({ message: `${Arr.join(argv, " ")} ran past a minute` })),
			}),
			Effect.catchTag("PlatformError", (error) =>
				Effect.fail(ScenarioFailed.make({ message: `${Arr.join(argv, " ")} did not start: ${error.message}` })),
			),
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
		);
});

export const startCore = Effect.fn("startCore")(
	function* ({ layout, env }: { readonly layout: Layout; readonly env: Env }) {
		const fs = yield* FileSystem.FileSystem;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const place = { env, cwd: layout.folder };

		yield* spawner.spawn(
			ChildProcess.make("sh", ["-c", 'exec herdr-core serve >>"$1" 2>&1', "core", layout.coreLog], {
				...place,
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				detached: false,
				forceKillAfter: "10 seconds",
			}),
		);

		yield* Effect.addFinalizer(() =>
			ran({ argv: ["hc", "server", "stop"], ...place }).pipe(
				Effect.timeout("10 seconds"),
				Effect.ignore,
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
			),
		);

		yield* fs.exists(layout.socket).pipe(
			Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("100 millis") }),
			Effect.timeoutOrElse({
				duration: "10 seconds",
				orElse: () =>
					Effect.fail(SetupFailed.make({ message: `the terminal core did not start, see ${layout.coreLog}` })),
			}),
		);
	},
	Effect.catchTag("PlatformError", (error) => Effect.fail(SetupFailed.make({ message: error.message }))),
);
