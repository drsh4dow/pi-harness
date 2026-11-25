import { expect, test } from "bun:test";

import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";
import * as TestClock from "effect/testing/TestClock";

import { entryKind } from "#src/features/owned-work/index.ts";
import { eventually } from "#src/primitives/eventually.ts";
import type { Run, Session, Sessions } from "#tools/driver/index.ts";
import { longestBodyLine, observe, plant, read, settledReply, turnEnds, versions, watch } from "./observe.ts";

const holding = (...requests: ReadonlyArray<string>): Sessions => ({
	root: { id: "root", file: "root.jsonl", entries: [], loaded: Option.none(), requests },
	delegates: [],
});

const json = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const rootOf = (lines: ReadonlyArray<unknown>): Session => {
	const text = Arr.join(
		Arr.map([{ type: "session", id: "root" }, ...lines], (line) => Option.getOrElse(json(line), () => "")),
		"\n",
	);

	const entries = Arr.filter(parseSessionEntries(text), (entry): entry is SessionEntry => entry.type !== "session");

	return { id: "root", file: "root.jsonl", entries, loaded: Option.none(), requests: [] };
};

const said = (text: string, stopReason: "stop" | "toolUse") => ({
	type: "message",
	message: {
		role: "assistant",
		stopReason,
		content: [{ type: "text", text }],
		usage: { totalTokens: 600, cost: { total: 0.125 } },
	},
});

const work = (type: string, handle: string) => ({ type: "custom", customType: entryKind, data: { type, handle } });

const oneAtATime = <Value>(values: ReadonlyArray<Value>) => {
	let next = 0;

	return Effect.suspend(() => {
		const value = Arr.get(values, next);

		next += 1;

		return Effect.fromOption(value);
	});
};

test("the root's turn ends are the text of each message that did not stop for a tool, oldest first, one that waits on a delegate included", () => {
	const root = rootOf([
		said("Reading the code.", "toolUse"),
		said("Started the reviewer, waiting on it.", "stop"),
		work("delegate-started", "delegate-1"),
		said("The reviewer says ship it.", "stop"),
	]);

	expect(turnEnds(root)).toEqual(["Started the reviewer, waiting on it.", "The reviewer says ship it."]);
});

test("the root's reply counts only once every job it started has settled and no owned-work entry follows it", () => {
	const started = work("delegate-started", "delegate-1");
	const settled = work("job-settled", "delegate-1");

	const replies = [
		rootOf([started, said("Waiting on the reviewer.", "stop")]),
		rootOf([started, said("Waiting on the reviewer.", "stop"), settled]),
		rootOf([started, said("Waiting on the reviewer.", "stop"), settled, said("Ship it.", "stop")]),
	];

	expect(Arr.map(replies, settledReply)).toEqual([Option.none(), Option.none(), Option.some("Ship it.")]);
});

test("a guide's longest body line leaves its frontmatter out", () => {
	const guide = `---
name: a-name-longer-than-any-line-of-the-body-below-it
---
# Swarm
Fan out parallel workers.
Done.
`;

	expect(longestBodyLine(guide)).toBe("Fan out parallel workers.");
});

test("once a look finds a build file edited, the run is judged on the sessions read before that edit", () => {
	const beforeEdit = holding("read the request");
	const afterEdit = holding("read the request, edited cyclefare/pricing.py, then read the architect skill");

	const watching = watch({
		beforeRequest: holding("nothing yet"),
		sessions: oneAtATime([beforeEdit, afterEdit]),
		files: oneAtATime([["README.md"], ["README.md", "cyclefare/pricing.py"]]),
		stopAt: Str.startsWith("cyclefare/"),
	});

	return Effect.runPromise(
		Effect.map(watching, (watched) => {
			expect(watched).toEqual({ sessions: beforeEdit, editedFiles: ["README.md", "cyclefare/pricing.py"] });
		}),
	);
});

test("the sessions a run is judged on never show the edit that stopped it, however the agent's steps fall between reads", () => {
	const actions = [
		{ request: "read the request", edited: [] },
		{ request: "edited cyclefare/pricing.py", edited: ["cyclefare/pricing.py"] },
		{ request: "read the architect skill", edited: [] },
		{ request: "edited cyclefare/rates.py", edited: ["cyclefare/rates.py"] },
	];

	let taken = 0;

	const act = Effect.sync(() => {
		taken += 1;

		return Arr.take(actions, taken);
	});

	const watching = watch({
		beforeRequest: holding(),
		sessions: Effect.map(act, (done) => holding(...Arr.map(done, ({ request }) => request))),
		files: Effect.map(act, (done) => Arr.flatMap(done, ({ edited }) => edited)),
		stopAt: Str.startsWith("cyclefare/"),
	});

	return Effect.runPromise(
		Effect.map(watching, ({ sessions }) => {
			expect(Arr.filter(sessions.root.requests, Str.startsWith("edited"))).toEqual([]);
		}),
	);
});

test("a run whose root settles is judged on the sessions it settled in", () => {
	const working = { root: rootOf([said("Reading the code.", "toolUse")]), delegates: [] };
	const settled = { root: rootOf([said("Reading the code.", "toolUse"), said("Done.", "stop")]), delegates: [] };

	const watching = watch({
		beforeRequest: holding(),
		sessions: oneAtATime([working, settled]),
		files: oneAtATime([[], []]),
		stopAt: () => true,
	});

	return Effect.runPromise(
		Effect.map(watching, (watched) => {
			expect(watched).toEqual({ sessions: settled, editedFiles: [] });
		}),
	);
});

const gitIdentity = [
	"env",
	"GIT_CONFIG_GLOBAL=/dev/null",
	"GIT_CONFIG_NOSYSTEM=1",
	"GIT_AUTHOR_NAME=t",
	"GIT_AUTHOR_EMAIL=t@t",
	"GIT_COMMITTER_NAME=t",
	"GIT_COMMITTER_EMAIL=t@t",
];

interface Faked {
	readonly run: Run;
	readonly printed: ReadonlyArray<Schema.Json>;
}

const fakeRun = ({
	folder,
	sessions,
}: {
	readonly folder: string;
	readonly sessions: Effect.Effect<Sessions>;
}): Faked => {
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

const inFolder = <Value, Failure>(
	body: (folder: string) => Effect.Effect<Value, Failure, FileSystem.FileSystem | Scope.Scope>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const folder = yield* fs.makeTempDirectoryScoped();

		yield* fs.makeDirectory(`${folder}/project`);

		return yield* body(folder);
	}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.runPromise);

const swarm = `---
name: swarm
---
# Swarm
Fan out parallel workers and return one report.
`;

test("a guide counts as read once the root's or any delegate's requests hold its longest body line", () =>
	inFolder((folder) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* fs.makeDirectory(`${folder}/agent/skills/swarm`, { recursive: true });
			yield* fs.writeFileString(`${folder}/agent/skills/swarm/SKILL.md`, swarm);

			const { run } = fakeRun({ folder, sessions: Effect.succeed(holding()) });
			const line = "Fan out parallel workers and return one report.";
			const delegate = holding(line).root;

			const reads = yield* Effect.forEach(
				[holding(), { ...holding(), delegates: [delegate] }, holding(line)],
				(sessions) => read({ run, sessions, guide: "skills/swarm/SKILL.md" }),
			);

			expect(reads).toEqual([false, true, true]);
		}),
	));

test("a file's versions are its text at every branch tip and in every worktree, never one only an older commit held", () =>
	inFolder((folder) =>
		Effect.gen(function* () {
			const { run } = fakeRun({ folder, sessions: Effect.succeed(holding()) });

			const setup = yield* run.exec([
				"sh",
				"-c",
				`git init -q -b main && echo v1 > notes.md && git add -A && git commit -qm one && echo v2 > notes.md && git commit -qam two
git checkout -q -b side && echo v3 > notes.md && git commit -qam three && git checkout -q main
git worktree add -q ../tree -b feature && echo v4 > ../tree/notes.md`,
			]);

			const found = yield* versions({ run, file: "notes.md" });

			const texts = Arr.filter(Str.split(found, "\n"), Str.isNonEmpty);

			expect(setup.code).toBe(0);
			expect(Arr.dedupe(Arr.sort(texts, Str.Order))).toEqual(["v2", "v3", "v4"]);
		}),
	));

test("planting a history makes one commit per entry, nine hours apart and the last nine hours ago, and pushes main to origin", () =>
	inFolder((folder) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const { run } = fakeRun({ folder, sessions: Effect.succeed(holding()) });

			const base = yield* plant({
				run,
				history: [
					{ subject: "start the app", textByProjectPath: { "README.md": "# Cyclefare\n" } },
					{ subject: "price rides", textByProjectPath: { "cyclefare/pricing.py": "RATE = 3\n" } },
					{ subject: "raise the rate", textByProjectPath: { "cyclefare/pricing.py": "RATE = 4\n" } },
				],
			});

			const log = yield* run.exec(["git", "log", "--reverse", "--format=%ct %at %s"]);
			const origin = yield* run.exec(["git", "-C", "../origin.git", "rev-parse", "main"]);
			const pricing = yield* fs.readFileString(`${folder}/project/cyclefare/pricing.py`);
			const now = (yield* Clock.currentTimeMillis) / 1000;
			const lines = Arr.filter(Str.split(log.output, "\n"), Str.isNonEmpty);

			const commits = Arr.map(lines, (line) => {
				const [committed, authored, ...subject] = Str.split(line, " ");

				return {
					hoursAgo: Math.round((now - Number(committed)) / 3600),
					authoredWhenCommitted: authored === committed,
					subject: Arr.join(subject, " "),
				};
			});

			expect(commits).toEqual([
				{ hoursAgo: 27, authoredWhenCommitted: true, subject: "start the app" },
				{ hoursAgo: 18, authoredWhenCommitted: true, subject: "price rides" },
				{ hoursAgo: 9, authoredWhenCommitted: true, subject: "raise the rate" },
			]);
			expect(Str.trim(origin.output)).toBe(base);
			expect(pricing).toBe("RATE = 4\n");
		}),
	));

const observeIn = ({
	folder,
	stop,
}: {
	readonly folder: string;
	readonly stop: { readonly stopAt?: (file: string) => boolean };
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		yield* fs.makeDirectory(`${folder}/agent/skills/swarm`, { recursive: true });
		yield* fs.makeDirectory(`${folder}/agent/playbooks`);
		yield* fs.writeFileString(`${folder}/agent/skills/swarm/SKILL.md`, swarm);
		yield* fs.writeFileString(`${folder}/agent/playbooks/align.md`, "# Align\nSettle the destination first.\n");

		const settled = {
			root: {
				...rootOf([said("Reading the code.", "toolUse"), said("Ship it.", "stop")]),
				requests: ["Fan out parallel workers and return one report."],
			},
			delegates: [{ ...holding("Settle the destination first.").root, id: "delegate-1" }],
		};

		const lookedAt: Array<number> = [];
		const looks = oneAtATime([holding(), settled]);

		const timed = Effect.andThen(
			Effect.tap(Clock.currentTimeMillis, (now) => Effect.sync(() => lookedAt.push(now))),
			looks,
		);

		const { run, printed } = fakeRun({ folder, sessions: Effect.orDie(timed) });
		const history = [{ subject: "start", textByProjectPath: { "README.md": "# App\n" } }];
		const base = yield* plant({ run, history });

		yield* fs.writeFileString(`${folder}/project/notes.md`, "audit notes\n");

		const clock = yield* TestClock.make();
		const observing = observe({ run, base, request: "Audit the app.", within: "1 day", ...stop });
		const fiber = yield* Effect.forkChild(Effect.provideService(observing, Clock.Clock, clock));
		const done = Effect.sync(() => fiber.pollUnsafe() !== undefined);

		yield* eventually(Effect.andThen(clock.adjust("1 second"), done), "20 seconds");

		const observed = yield* Fiber.join(fiber);

		return { observed, printed, sinceStart: Arr.map(lookedAt, (at) => at - (lookedAt[0] ?? 0)) };
	});

test("observe looks every 5 seconds until the root settles, then prints the spend, what each session read, the files edited and the reply", () =>
	inFolder((folder) =>
		Effect.gen(function* () {
			const { observed, printed, sinceStart } = yield* observeIn({ folder, stop: {} });

			expect(observed.editedFiles).toEqual(["notes.md"]);
			expect(sinceStart).toEqual([0, 5000]);
			expect(printed).toEqual([
				"spent 1200 tokens, $0.25 at catalog prices, over 2 sessions",
				"root read skills/swarm/SKILL.md",
				"delegate delegate-1 read playbooks/align.md",
				"files edited: notes.md",
				"root's last reply:\nShip it.",
			]);
		}),
	));

test("observe given stopAt stops at the first look that finds a file it matches edited, and prints the sessions from before the edit", () =>
	inFolder((folder) =>
		Effect.gen(function* () {
			const { observed, printed } = yield* observeIn({ folder, stop: { stopAt: (file) => file === "notes.md" } });

			expect(observed.sessions).toEqual(holding());
			expect(printed).toEqual([
				"spent 0 tokens, $0.00 at catalog prices, over 1 sessions",
				"root read no skill or playbook",
				"files edited: notes.md",
				"the root never settled idle",
			]);
		}),
	));
