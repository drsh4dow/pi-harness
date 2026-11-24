import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

/** What a command printed last, and how it ended. */
export interface Ran {
	readonly exitCode: number;
	readonly tail: string;
}

const tailLines = 40;

const tailBytes = 64 * 1024;

/** The last bytes of the output, about `tailBytes` of them. */
const tailKeeper = () => {
	const kept: Array<Uint8Array> = [];
	let bytes = 0;

	const keep = (chunk: Uint8Array) =>
		Effect.sync(() => {
			kept.push(chunk);
			bytes += chunk.length;

			while (bytes - (kept[0]?.length ?? 0) > tailBytes) {
				bytes -= kept.shift()?.length ?? 0;
			}
		});

	const lines = () => {
		const text = Str.trimEnd(new TextDecoder().decode(Buffer.concat(kept)));

		return Arr.join(Arr.takeRight(Str.split(text, "\n"), tailLines), "\n");
	};

	return { keep, lines };
};

/**
 * Runs the command with its output passed through to this process's own, and keeps the last lines of both streams.
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
			const tail = tailKeeper();
			const handle = yield* spawner.spawn(ChildProcess.make(file, args, { cwd, stdin: "inherit", detached: false }));
			const stdout = Stream.run(Stream.tap(handle.stdout, tail.keep), stdio.stdout({ endOnDone: false }));
			const stderr = Stream.run(Stream.tap(handle.stderr, tail.keep), stdio.stderr({ endOnDone: false }));
			const [exitCode] = yield* Effect.all([handle.exitCode, stdout, stderr], { concurrency: 3 });

			return { exitCode, tail: tail.lines() };
		}),
	);
