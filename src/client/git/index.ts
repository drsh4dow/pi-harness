import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

export class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()("GitError", {
	args: Schema.Array(Schema.String),
	why: Schema.String,
}) {}

type Environment = Readonly<Record<string, string | undefined>>;

const text = <Failure>(stream: Stream.Stream<Uint8Array, Failure>) => stream.pipe(Stream.decodeText, Stream.mkString);

const output = (args: ReadonlyArray<string>, input: string, env: Environment) =>
	Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) => {
		const failed = (why: string) => GitError.make({ args: ["git", ...args], why });
		const stdin = Stream.make(new TextEncoder().encode(input));

		return spawner.spawn(ChildProcess.make("git", args, { stdin, env: { ...env }, extendEnv: true })).pipe(
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
		);
	});

const withoutCallerRepository = Effect.map(output(["rev-parse", "--local-env-vars"], "", {}), (names) =>
	Rec.fromIterableWith(Str.split(Str.trim(names), "\n"), (name): [string, undefined] => [name, undefined]),
);

export const git = ({
	args,
	input = "",
	env = {},
}: {
	readonly args: ReadonlyArray<string>;
	readonly input?: string;
	readonly env?: Readonly<Record<string, string>>;
}): Effect.Effect<string, GitError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.flatMap(withoutCallerRepository, (dropped) => output(args, input, { ...dropped, ...env }));
