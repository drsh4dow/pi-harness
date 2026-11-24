import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";

const Call = Schema.Struct({
	type: Schema.Literal("toolCall"),
	id: Schema.String,
	name: Schema.String,
});

const Part = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) });

const Result = Schema.Struct({
	type: Schema.Literal("message"),
	message: Schema.Struct({
		role: Schema.Literal("toolResult"),
		toolCallId: Schema.String,
		isError: Schema.Boolean,
		content: Schema.Array(Part),
	}),
});

const decodeCall = Schema.decodeUnknownOption(Call);
const decodeResult = Schema.decodeUnknownOption(Result);

interface Ran {
	readonly name: string;
	readonly isError: boolean;
	readonly text: string;
}

const callsIn = (entry: SessionEntry) =>
	entry.type === "message" && entry.message.role === "assistant"
		? Arr.getSomes(Arr.map(entry.message.content, (part) => decodeCall(part)))
		: [];

const runs = (entries: ReadonlyArray<SessionEntry>): ReadonlyArray<Ran> => {
	const calls = Arr.flatMap(entries, callsIn);
	const results = Arr.getSomes(Arr.map(entries, (entry) => decodeResult(entry)));

	return Arr.getSomes(
		Arr.map(results, ({ message }) => {
			const call = Arr.findFirst(calls, ({ id }) => id === message.toolCallId);

			const text = Arr.join(
				Arr.map(message.content, (part) => part.text ?? ""),
				"\n",
			);

			return Option.map(call, ({ name }) => ({ name, isError: message.isError, text }));
		}),
	);
};

const ranTool = (run: Run, name: string) =>
	run.waitFor(`the ${name} result`, "60 seconds", ({ root }) =>
		Arr.findFirst(runs(root.entries), (ran) => ran.name === name),
	);

const holdsAll = (text: string, parts: ReadonlyArray<string>) => Arr.every(parts, (part) => Str.includes(part)(text));

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) =>
		Effect.gen(function* () {
			yield* run.exec([
				"sh",
				"-c",
				String.raw`printf 'alpha-1\nalpha-2\n' > a.txt; printf 'beta-1\nbeta-2\nbeta-3\n' > b.txt; printf 'before-needle\nthe needle line\nafter-needle\n' > c.txt`,
			]);

			yield* run.root.prompt(
				Arr.join(
					[
						"This is a harness test. Make exactly these two tool calls, one at a time, then reply done:",
						'1. read with paths [{"path": "a.txt"}, {"path": "b.txt", "offset": 2, "limit": 1}] and no path.',
						'2. grep with pattern "needle line", path "c.txt" and context 1.',
					],
					"\n",
				),
			);

			const read = yield* ranTool(run, "read");
			const grep = yield* ranTool(run, "grep");

			yield* run.say(`read\n${read.text}\ngrep\n${grep.text}`);
			yield* run.check(
				!read.isError &&
					holdsAll(read.text, ["==> a.txt <==", "alpha-1", "alpha-2", "==> b.txt <==", "beta-2"]) &&
					!Str.includes("beta-1")(read.text) &&
					Str.split(read.text, "==> ").length === 3,
				`one read call returns a.txt whole and line 2 of b.txt under their two headers, and nothing else (isError ${String(read.isError)})`,
			);
			yield* run.check(
				!grep.isError && holdsAll(grep.text, ["before-needle", "the needle line", "after-needle"]),
				`grep returns the match with one line of context on each side (isError ${String(grep.isError)})`,
			);

			const sessions = yield* run.waitFor("the root's session", "10 seconds", (all) => Option.some(all.root));

			yield* run.check(
				Arr.some(sessions.requests, (request) => Str.includes("Use read with `paths`")(request)) &&
					Arr.some(sessions.requests, (request) => Str.includes("Use grep with `context`")(request)),
				"the prompt carries the read and grep rules",
			);
		}),
});
