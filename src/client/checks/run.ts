import type * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";

/** What a command printed to each stream. */
export interface Output {
	readonly stdout: string;
	readonly stderr: string;
}

/** How a command ended, and what it printed unless it printed more than `keptBytes`. */
export interface Ran {
	readonly exitCode: number;
	readonly output: Option.Option<Output>;
}

export const keptBytes = 1024 * 1024;

const keeper = () => {
	const chunks: Array<Uint8Array> = [];
	let bytes = 0;

	const keep = (chunk: Uint8Array) =>
		Effect.sync(() => {
			bytes += chunk.length;

			if (bytes <= keptBytes) {
				chunks.push(chunk);
			}
		});

	return { keep, bytes: () => bytes, text: () => new TextDecoder().decode(Buffer.concat(chunks)) };
};

/**
 * Runs the command with its output passed through to this process's own, and keeps what each stream printed.
 * The command stays in this process's process group, so whatever stops the caller's group stops it too.
 */
export const runShown = ({
	command: [file, ...args],
	cwd,
}: {
	readonly command: Arr.NonEmptyReadonlyArray<string>;
	readonly cwd: string;
}): Effect.Effect<Ran, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Stdio.Stdio> =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const stdio = yield* Stdio.Stdio;
			const [out, err] = [keeper(), keeper()];
			const handle = yield* spawner.spawn(ChildProcess.make(file, args, { cwd, stdin: "inherit", detached: false }));
			const stdout = Stream.run(Stream.tap(handle.stdout, out.keep), stdio.stdout({ endOnDone: false }));
			const stderr = Stream.run(Stream.tap(handle.stderr, err.keep), stdio.stderr({ endOnDone: false }));
			const [exitCode] = yield* Effect.all([handle.exitCode, stdout, stderr], { concurrency: 3 });
			const kept = out.bytes() + err.bytes() <= keptBytes;

			return { exitCode, output: kept ? Option.some({ stdout: out.text(), stderr: err.text() }) : Option.none() };
		}),
	);

/** Prints what a command printed earlier, each stream to its own. */
export const replay = ({ stdout, stderr }: Output) =>
	Effect.flatMap(Stdio.Stdio, (stdio) =>
		Effect.andThen(
			Stream.run(Stream.make(stdout), stdio.stdout({ endOnDone: false })),
			Stream.run(Stream.make(stderr), stdio.stderr({ endOnDone: false })),
		),
	);
