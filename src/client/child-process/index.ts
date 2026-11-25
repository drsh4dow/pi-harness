import * as Effect from "effect/Effect";
import type * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

const text = <Failure>(stream: Stream.Stream<Uint8Array, Failure>) => stream.pipe(Stream.decodeText, Stream.mkString);

export const stdoutOf = <Failure>({
	command,
	failed,
}: {
	readonly command: ChildProcess.Command;
	readonly failed: (why: string) => Failure;
}): Effect.Effect<string, Failure, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
		spawner.spawn(command).pipe(
			Effect.flatMap((handle) =>
				Effect.all(
					{ code: handle.exitCode, stdout: text(handle.stdout), stderr: text(handle.stderr) },
					{ concurrency: 3 },
				),
			),
			Effect.scoped,
			Effect.mapError((error) => failed(error.message)),
			Effect.filterOrFail(
				({ code }) => code === 0,
				({ stderr }) => failed(Str.trim(stderr)),
			),
			Effect.map(({ stdout }) => stdout),
		),
	);
