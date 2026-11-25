import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

import { stdoutOf } from "#src/client/child-process/index.ts";

export class GitError extends Schema.TaggedError<GitError, { readonly brand: unique symbol }>()("GitError", {
	args: Schema.Array(Schema.String),
	why: Schema.String,
}) {}

type Environment = Readonly<Record<string, string | undefined>>;

const output = (args: ReadonlyArray<string>, input: string, env: Environment) => {
	const stdin = Stream.make(new TextEncoder().encode(input));

	return stdoutOf({
		command: ChildProcess.make("git", args, { stdin, env: { ...env }, extendEnv: true }),
		failed: (why) => GitError.make({ args: ["git", ...args], why }),
	});
};

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
