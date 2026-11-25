import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import { type Run, scenario } from "#tools/driver/index.ts";

const makefile = Arr.join(
	["test:", '\t@echo run >> "$(HOME)/runs"; sleep 1; echo tests ok', "test-slow:", "\t@sleep 5; echo slow ok", ""],
	"\n",
);

const concurrent = "for i in 1 2 3 4 5 6 7 8; do make test-slow & done; wait";

const steps = Arr.join(
	[
		"Do these steps in order, each with its own tool call, then end your turn without waiting for anything.",
		"1. Run `make test` with the bash tool.",
		"2. Run `make test` with the bash tool again.",
		`3. Run \`${concurrent}\` with the bash tool.`,
		"4. Start a watch with the watch tool on the command `make test`.",
		"5. Start one leaf with the delegate tool. Its whole task: run `make test` with the bash tool and reply with its output.",
	],
	"\n",
);

const Text = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) });

const ToolMessage = Schema.Struct({
	role: Schema.Literal("toolResult"),
	toolName: Schema.String,
	content: Schema.Array(Text),
});

const ToolResult = Schema.Struct({ type: Schema.Literal("message"), message: ToolMessage });

const Outcome = Schema.Struct({ status: Schema.String, tail: Schema.optionalKey(Schema.String) });

const Wake = Schema.Struct({
	type: Schema.Literal("custom_message"),
	customType: Schema.Literal(entryKind),
	details: Schema.Struct({ kind: Schema.String, outcome: Outcome }),
});

const decodeToolResult = Schema.decodeUnknownOption(ToolResult);

const decodeWake = Schema.decodeUnknownOption(Wake);

const textOf = ({ content }: typeof ToolMessage.Type) =>
	Arr.join(
		Arr.map(content, (part) => part.text ?? ""),
		"\n",
	);

const bashOutputsOf = (entries: ReadonlyArray<SessionEntry>) => {
	const results = Arr.getSomes(Arr.map(entries, (entry) => decodeToolResult(entry)));

	return Arr.map(
		Arr.filter(results, ({ message }) => message.toolName === "bash"),
		({ message }) => textOf(message),
	);
};

const wakeOf = (entries: ReadonlyArray<SessionEntry>, kind: string) =>
	Arr.findFirst(entries, (entry) => Option.filter(decodeWake(entry), ({ details }) => details.kind === kind));

interface Printed {
	readonly output: string;
	readonly includes: string;
	readonly claim: string;
}

const printed = (run: Run, { output, includes, claim }: Printed) =>
	run.check(Str.includes(includes)(output), `${claim} (it printed: ${Str.slice(-600)(output)})`);

const seeded = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const { output } = yield* run.exec(["pwd"]);

		yield* run.exec(["git", "init", "-q"]);
		yield* fs.writeFileString(`${Str.trim(output)}/Makefile`, makefile);
	});

const wakesOf = (run: Run) =>
	run.waitFor("the watch's and the leaf's wakes", "5 minutes", (found) =>
		Option.all({
			root: Option.some(found.root),
			watch: wakeOf(found.root.entries, "watch"),
			done: wakeOf(found.root.entries, "delegate"),
			leaf: Arr.head(found.delegates),
		}),
	);

interface Seen {
	readonly first: string;
	readonly second: string;
	readonly together: string;
	readonly watched: string;
	readonly leafRun: string;
	readonly runs: number;
}

const judged = (run: Run, seen: Seen) =>
	Effect.gen(function* () {
		yield* run.say({ ...seen });
		yield* printed(run, {
			output: seen.first,
			includes: "check: receipt",
			claim: "the first `make test` ran and recorded a receipt",
		});
		yield* printed(run, {
			output: seen.second,
			includes: "tests ok\ncheck: receipt",
			claim: "the second printed the first one's output and receipt",
		});
		yield* run.check(seen.runs === 1, `make test ran once (it ran ${String(seen.runs)} times)`);
		yield* printed(run, {
			output: seen.together,
			includes: "check: queued",
			claim: "a check past the slot count queued",
		});
		yield* printed(run, {
			output: seen.together,
			includes: "got a place after",
			claim: "the queued check ran once a slot freed",
		});
		yield* printed(run, {
			output: seen.watched,
			includes: "did not run again",
			claim: "the watch's `make test` printed the receipt",
		});
		yield* printed(run, {
			output: seen.leafRun,
			includes: "did not run again",
			claim: "the leaf's `make test` printed the receipt",
		});
	});

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* seeded(run);
			yield* run.root.prompt(steps);

			const { root, watch, leaf } = yield* wakesOf(run);
			const [first = "", second = "", together = ""] = bashOutputsOf(root.entries);
			const [leafRun = ""] = bashOutputsOf(leaf.entries);
			const runs = yield* fs.readFileString(`${run.home}/runs`);
			const watched = watch.details.outcome.tail ?? "";

			yield* judged(run, {
				first,
				second,
				together,
				watched,
				leafRun,
				runs: Str.split(Str.trim(runs), "\n").length,
			});
		}),
});
