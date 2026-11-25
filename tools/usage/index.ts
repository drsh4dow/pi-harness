/**
 * `bun run usage [--since <date>] [--until <date>] [--sessions <dir>]` prints, as markdown, how often each guide on disk
 * was listed and loaded in the pi sessions that started in the window, how often each guide loaded at its event, and
 * the delegate calls. It reads every session in pi's own `sessions/` folder unless `--sessions` names another folder, and prints
 * counts and guide names only. The window starts 7 days ago by default, and `--until` leaves out sessions that started
 * at or after it.
 */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { git } from "#src/client/git/index.ts";
import { type GuideFile, guideFilesIn, readGuides } from "#src/features/loaded/index.ts";
import { libraryOf } from "./guides.ts";
import { reportOf } from "./report.ts";
import { factsOf } from "./session.ts";

const root = Str.replace(/\/tools\/usage$/u, "")(import.meta.dirname);
const week = 7 * 24 * 60 * 60 * 1000;
const usage = "usage: bun run usage [--since <date>] [--until <date>] [--sessions <dir>]";
const flagNames = ["--since", "--until", "--sessions"];
const guideFolders = ["agent/skills", "agent/playbooks", "agent/principles", "src/features/web"];

const guidePath =
	/^(?:agent\/skills\/(?<skill>[^/]+)\/SKILL\.md|src\/features\/web\/(?<web>[^/]+)\/SKILL\.md|agent\/(?:playbooks|principles)\/(?<file>[^/]+)\.md)$/u;

/** Pi names a session file by the time it started, such as `2026-11-08T13-53-21-192Z_<id>.jsonl`. */
const startedName =
	/(?:^|\/)(?<date>\d{4}-\d{2}-\d{2})T(?<hours>\d{2})-(?<minutes>\d{2})-(?<seconds>\d{2})-(?<millis>\d{3})Z_[^/]*\.jsonl$/u;

class UsageError extends Schema.TaggedError<UsageError, { readonly brand: unique symbol }>()("UsageError", {
	message: Schema.String,
}) {}

interface Window {
	readonly since: number;
	readonly until: number;
	readonly sessions: string;
}

const instantOf = (flag: string, text: string) => {
	const instant = Date.parse(text);

	return Number.isNaN(instant)
		? UsageError.make({ message: `${flag} takes a date, got ${text}` })
		: Effect.succeed(instant);
};

const windowOf = Effect.fn("windowOf")(function* (argv: ReadonlyArray<string>) {
	const pairs = Arr.chunksOf(argv, 2);
	const flags = new Map(Arr.map(pairs, ([flag, value]) => [flag, value]));
	const since = flags.get("--since");
	const until = flags.get("--until");

	if (Arr.some(pairs, ([flag, value]) => value === undefined || !Arr.contains(flagNames, flag))) {
		return yield* UsageError.make({ message: usage });
	}

	return {
		since: since === undefined ? (yield* Clock.currentTimeMillis) - week : yield* instantOf("--since", since),
		until: until === undefined ? Number.POSITIVE_INFINITY : yield* instantOf("--until", until),
		sessions: flags.get("--sessions") ?? `${getAgentDir()}/sessions`,
	} satisfies Window;
});

const gitInRoot = (args: ReadonlyArray<string>) => Effect.option(git({ args: ["-C", root, ...args] }));

const touched = (log: string) => {
	let commit = "";

	return Arr.flatMap(Str.split(log, "\n"), (line) => {
		const groups = guidePath.exec(line)?.groups;
		const name = groups?.["skill"] ?? groups?.["web"] ?? groups?.["file"];

		if (Str.startsWith("@")(line)) {
			commit = Str.slice(1)(line);
		}

		return name === undefined ? [] : [{ name, object: `${commit}:${line}` }];
	});
};

const pastGuides = Effect.gen(function* () {
	const log = yield* gitInRoot(["log", "--format=@%H", "--name-only", "--", ...guideFolders]);

	const versions = yield* Effect.forEach(
		touched(Option.getOrElse(log, () => "")),
		({ name, object }) =>
			Effect.map(
				gitInRoot(["show", object]),
				Option.map((text) => ({ name, text })),
			),
		{ concurrency: 16 },
	);

	return Arr.getSomes(versions);
});

const skillFilesIn = Effect.fn("skillFilesIn")(function* (dir: string) {
	const fs = yield* FileSystem.FileSystem;
	const names = yield* fs.readDirectory(dir);

	return Arr.map(names, (name): GuideFile => ({ kind: "skill", name, path: `${dir}/${name}/SKILL.md` }));
});

const todayGuides = Effect.gen(function* () {
	const skills = yield* Effect.forEach([`${root}/agent/skills`, `${root}/src/features/web`], skillFilesIn);
	const principles = yield* guideFilesIn("principle", `${root}/agent/principles`);
	const playbooks = yield* guideFilesIn("playbook", `${root}/agent/playbooks`);

	return yield* readGuides([...Arr.flatten(skills), ...principles, ...playbooks]);
});

const startOf = (file: string) => {
	const groups = startedName.exec(file)?.groups;

	return groups === undefined
		? Number.NaN
		: Date.parse(
				`${groups["date"]}T${groups["hours"]}:${groups["minutes"]}:${groups["seconds"]}.${groups["millis"]}Z`,
			);
};

const sessionFiles = Effect.fn("sessionFiles")(function* ({ since, until, sessions }: Window) {
	const fs = yield* FileSystem.FileSystem;
	const listed = yield* fs.readDirectory(sessions, { recursive: true });

	const inWindow = Arr.filter(listed, (file) => {
		const started = startOf(file);

		return started >= since && started < until;
	});

	return Arr.map(inWindow, (file) => `${sessions}/${file}`);
});

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const window = yield* windowOf(Arr.drop(process.argv, 2));
	const [today, past] = yield* Effect.all([todayGuides, pastGuides], { concurrency: 2 });
	const library = libraryOf({ today, past });
	const files = yield* sessionFiles(window);
	const readFacts = (file: string) => Effect.map(fs.readFileString(file), (text) => factsOf({ library, text }));
	const facts = yield* Effect.forEach(files, readFacts, { concurrency: 8 });

	yield* Console.log(reportOf({ library, sessions: Arr.getSomes(facts) }));
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
