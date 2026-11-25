import { expect, test } from "bun:test";

import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as TestClock from "effect/testing/TestClock";

import { entryKind } from "#src/features/owned-work/index.ts";
import { eventually } from "#src/primitives/eventually.ts";
import type { Run, Sessions } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, type Timeline, type Window } from "./timeline.ts";

const swarmLine = "Fan out parallel workers and return one report.";

const principleLine = "Fix the cause, not the place it showed up.";

const at = (second: number) => `2026-11-19T10:00:${Str.padStart(2, "0")(String(second))}.000Z`;

const usage = { totalTokens: 600, cost: { total: 0.125 } };

const calling = (second: number, tools: ReadonlyArray<string>) => ({
	type: "message",
	timestamp: at(second),
	message: {
		role: "assistant",
		stopReason: "toolUse",
		usage,
		content: Arr.map(tools, (name, index) => ({
			type: "toolCall",
			id: `call-${String(index)}`,
			name,
			arguments: {},
		})),
	},
});

const replying = (second: number, text: string) => ({
	type: "message",
	timestamp: at(second),
	message: { role: "assistant", stopReason: "stop", usage, content: [{ type: "text", text }] },
});

const holding = (second: number, line: string) => ({
	type: "message",
	timestamp: at(second),
	message: { role: "toolResult", isError: false, content: [{ type: "text", text: `# Guide\n\n${line}\n` }] },
});

const started = (second: number) => ({
	type: "custom",
	timestamp: at(second),
	customType: entryKind,
	data: { type: "delegate-started", handle: `delegate-${String(second)}` },
});

const json = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const rootOf = (lines: ReadonlyArray<unknown>): Sessions => {
	const text = Arr.join(
		Arr.map([{ type: "session", id: "root" }, ...lines], (line) => Option.getOrElse(json(line), () => "")),
		"\n",
	);

	const entries = Arr.filter(parseSessionEntries(text), (entry): entry is SessionEntry => entry.type !== "session");

	return { root: { id: "root", file: "root.jsonl", entries, loaded: Option.none(), requests: [] }, delegates: [] };
};

const gitIdentity = [
	"env",
	"GIT_CONFIG_GLOBAL=/dev/null",
	"GIT_CONFIG_NOSYSTEM=1",
	"GIT_AUTHOR_NAME=t",
	"GIT_AUTHOR_EMAIL=t@t",
	"GIT_COMMITTER_NAME=t",
	"GIT_COMMITTER_EMAIL=t@t",
];

const fakeRun = ({ folder, sessions }: { readonly folder: string; readonly sessions: Effect.Effect<Sessions> }) => {
	const printed: Array<Schema.Json> = [];

	const run: Run = {
		pi: { version: "1.5.2", path: "/pi" },
		agentDir: `${folder}/agent`,
		home: `${folder}/home`,
		root: {
			prompt: () => Effect.never,
			steer: () => Effect.void,
			compact: Effect.void,
			output: Effect.succeed(""),
		},
		waitFor: (what, _within, find) =>
			Effect.flatMap(sessions, (now) =>
				Option.match(find(now), { onNone: () => Effect.die(`no ${what}`), onSome: Effect.succeed }),
			),
		exec: (argv) =>
			Effect.suspend(() => {
				const child = Bun.spawn([...gitIdentity, ...argv], {
					cwd: `${folder}/project`,
					stdout: "pipe",
					stderr: "pipe",
				});

				const ended = Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);

				return Effect.map(
					Effect.promise(() => ended),
					([code, out, err]) => ({ code, output: `${out}${err}` }),
				);
			}),
		say: (value) =>
			Effect.sync(() => {
				printed.push(value);
			}),
		check: (condition, claim) => (condition ? Effect.void : Effect.die(claim)),
		spawn: () => Effect.die("the test starts no other pi"),
	};

	return { run, printed };
};

const measured = ({
	sessions,
	event,
}: {
	readonly sessions: Effect.Effect<Sessions>;
	readonly event: (timeline: Timeline) => Option.Option<Window>;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const folder = yield* fs.makeTempDirectoryScoped();

		yield* Effect.forEach(
			["project", "home", "bin", "agent/skills/swarm", "agent/playbooks", "agent/principles"],
			(dir) => fs.makeDirectory(`${folder}/${dir}`, { recursive: true }),
		);
		yield* fs.writeFileString(`${folder}/agent/skills/swarm/SKILL.md`, `# Swarm\n${swarmLine}\n`);
		yield* fs.writeFileString(
			`${folder}/agent/principles/fix-root-causes.md`,
			`# Fix root causes\n${principleLine}\n`,
		);

		const { run, printed } = fakeRun({ folder, sessions });

		const measuring = measure({
			run,
			guides: ["skills/swarm/SKILL.md"],
			history: [{ subject: "start", textByProjectPath: { "README.md": "# App\n" } }],
			request: "Review the app.",
			within: "1 minute",
			event,
		});

		const clock = yield* TestClock.make();
		const fiber = yield* Effect.forkChild(Effect.provideService(measuring, Clock.Clock, clock));
		const done = Effect.sync(() => fiber.pollUnsafe() !== undefined);

		yield* eventually(Effect.andThen(clock.adjust("1 second"), done), "20 seconds");

		const exit = yield* Fiber.join(fiber).pipe(Effect.exit);

		return { passed: Exit.isSuccess(exit), printed };
	});

const inTest = <Value, Failure>(
	effect: Effect.Effect<Value, Failure, FileSystem.FileSystem | Path.Path | Scope.Scope>,
) => effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise);

const fanOut = (timeline: Timeline) =>
	Option.map(
		Arr.findFirst(timeline.steps, (step) => step.delegatesStarted >= 3),
		before,
	);

const never = () => Option.none();

test("measure stops at the root's settled reply and prints the reads, the window, the principles and the verdict", () => {
	const sessions = rootOf([
		calling(1, ["read", "read"]),
		holding(2, swarmLine),
		holding(3, principleLine),
		replying(4, "Done."),
	]);

	return inTest(
		Effect.gen(function* () {
			const result = yield* measured({ sessions: Effect.succeed(sessions), event: never });

			expect(result).toEqual({
				passed: true,
				printed: [
					`read skills/swarm/SKILL.md at ${at(2)} by root`,
					"event none in 2 steps",
					"principles fix-root-causes",
					"verdict no-event unknown settled",
				],
			});
		}),
	);
});

test("measure stops once its event finds a window, and a miss passes", () => {
	const sessions = rootOf([
		calling(1, ["read", "delegate", "delegate", "delegate"]),
		started(2),
		started(2),
		started(2),
		holding(3, swarmLine),
	]);

	return inTest(
		Effect.gen(function* () {
			const result = yield* measured({ sessions: Effect.succeed(sessions), event: fanOut });

			expect(result).toEqual({
				passed: true,
				printed: [
					`read skills/swarm/SKILL.md at ${at(3)} by root`,
					`event from start to ${at(1)}`,
					"principles none",
					"verdict miss unknown event",
				],
			});
		}),
	);
});

test("measure stops when its time budget runs out", () => {
	const sessions = rootOf([calling(1, ["read"])]);

	return inTest(
		Effect.gen(function* () {
			const result = yield* measured({ sessions: Effect.succeed(sessions), event: never });

			expect(result).toEqual({
				passed: true,
				printed: [
					"read skills/swarm/SKILL.md never",
					"event none in 1 steps",
					"principles none",
					"verdict no-event unknown budget",
				],
			});
		}),
	);
});

test("a run that breaks prints no verdict", () =>
	inTest(
		Effect.gen(function* () {
			const result = yield* measured({ sessions: Effect.die("the root pi exited"), event: never });

			expect(result).toEqual({ passed: false, printed: [] });
		}),
	));
