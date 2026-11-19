import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import type { Run, Session, Sessions } from "#tools/driver/index.ts";

export const rootModel = "ultra-a/claude-opus-5-5";

/**
 * The run borrows the human's gh login. This default host, unreachable, keeps an agent that tries `gh repo create` or
 * `gh api` off GitHub: set it as `GH_HOST` in the scenario's `env`.
 */
export const offGitHub = "github.invalid";

/** One commit of the user's history: its subject and the files it writes, by path inside the project. */
export interface Commit {
	readonly subject: string;
	readonly files: Readonly<Record<string, string>>;
}

const Work = Schema.Struct({
	type: Schema.Literal("custom"),
	customType: Schema.Literal(entryKind),
	data: Schema.Struct({ type: Schema.String, handle: Schema.String }),
});

const decodeWork = Schema.decodeUnknownOption(Work);

type Assistant = Extract<Extract<SessionEntry, { type: "message" }>["message"], { role: "assistant" }>;

const assistantOf = (entry: SessionEntry): Option.Option<Assistant> =>
	entry.type === "message" && entry.message.role === "assistant" ? Option.some(entry.message) : Option.none();

const textOf = (message: Assistant) =>
	Arr.join(
		Arr.flatMap(message.content, (part) => (part.type === "text" ? [part.text] : [])),
		"\n",
	);

const endsTurn = (message: Assistant) => message.stopReason !== "toolUse";

const everyone = (sessions: Sessions) => [sessions.root, ...sessions.delegates];

/** The text of each turn the root ended, oldest first. A turn that ends to wait on a delegate counts. */
export const turnEnds = (root: Session): ReadonlyArray<string> =>
	Arr.map(Arr.getSomes(Arr.map(root.entries, (entry) => Option.filter(assistantOf(entry), endsTurn))), textOf);

const settledReply = (root: Session): Option.Option<string> => {
	const work = Arr.getSomes(
		Arr.map(root.entries, (entry, index) => Option.map(decodeWork(entry), ({ data }) => ({ ...data, index }))),
	);

	const settled = new Set(Arr.flatMap(work, ({ type, handle }) => (type === "job-settled" ? [handle] : [])));
	const lastWork = Arr.reduce(work, -1, (last, { index }) => Math.max(last, index));
	const lastEnd = Arr.findLastIndex(root.entries, (entry) => Option.exists(assistantOf(entry), endsTurn));

	const afterEveryJobSettled = (index: number) =>
		index > lastWork && Arr.every(work, ({ handle }) => settled.has(handle));

	return Option.flatMap(Option.filter(lastEnd, afterEveryJobSettled), (index) =>
		Option.map(Option.flatMap(Arr.get(root.entries, index), assistantOf), textOf),
	);
};

const byLength = Order.mapInput(Order.Number, Str.length);

const longestBodyLine = (text: string) => {
	const body = Str.replace(/^---\n[\s\S]*?\n---\n/u, "")(text);

	return Arr.max(Str.split(body, "\n"), byLength);
};

const holds = (session: Session, line: string) => Arr.some(session.requests, Str.includes(line));

/** Whether the root or any delegate read the guide at `guide`, a path inside the agent folder. */
export const read = ({
	run,
	sessions,
	guide,
}: {
	readonly run: Run;
	readonly sessions: Sessions;
	readonly guide: string;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs.readFileString(`${run.agentDir}/${guide}`);

		return Arr.some(everyone(sessions), (session) => holds(session, longestBodyLine(text)));
	});

const guides = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const skills = yield* fs.readDirectory(`${run.agentDir}/skills`);
		const playbooks = yield* fs.readDirectory(`${run.agentDir}/playbooks`);

		const named = [
			...Arr.map(skills, (name) => `skills/${name}/SKILL.md`),
			...Arr.map(Arr.filter(playbooks, Str.endsWith(".md")), (name) => `playbooks/${name}`),
		];

		const files = yield* Effect.filter(named, (guide) => fs.exists(`${run.agentDir}/${guide}`));

		return yield* Effect.forEach(files, (guide) =>
			Effect.map(fs.readFileString(`${run.agentDir}/${guide}`), (text) => ({ guide, line: longestBodyLine(text) })),
		);
	});

const sh = (run: Run, script: string) =>
	Effect.tap(run.exec(["sh", "-c", script]), ({ code, output }) =>
		run.check(code === 0, `the command exits 0 (it exited ${String(code)}: ${output}): ${script}`),
	);

const eachWorktree = (command: string) =>
	`git worktree list --porcelain | sed -n 's/^worktree //p' | while read -r tree; do ${command}; done`;

const filesChangedSince = ({ run, base }: { readonly run: Run; readonly base: string }) =>
	Effect.map(
		sh(
			run,
			`{ git log --all --name-only --format= ^${base}
${eachWorktree(`git -C "$tree" status --porcelain --untracked-files=all -- . ':(exclude).worktrees' | cut -c4-`)}
} | sort -u`,
		),
		({ output }) => Arr.filter(Str.split(output, "\n"), Str.isNonEmpty),
	);

/** The text of `file` at the tip of every branch and in every worktree, so an edit later undone no longer shows. */
export const versions = ({ run, file }: { readonly run: Run; readonly file: string }) =>
	Effect.map(
		sh(
			run,
			`git for-each-ref --format='%(refname)' refs/heads | while read -r ref; do git show "$ref:${file}" 2>/dev/null || true; done
${eachWorktree(`cat "$tree/${file}" 2>/dev/null || true`)}`,
		),
		({ output }) => output,
	);

/**
 * Writes the user's history into the root's project folder, one commit each, nine hours apart and the last nine hours ago, pushes `main` to `origin.git` beside the
 * project, and returns the last commit, so `filesChangedSince` sees only what came after.
 */
export const plant = ({ run, history }: { readonly run: Run; readonly history: ReadonlyArray<Commit> }) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const project = Str.trim((yield* sh(run, "pwd -P")).output);

		const write = ([file, text]: readonly [string, string]) =>
			Effect.andThen(
				fs.makeDirectory(Str.replace(/\/[^/]+$/u, "")(`${project}/${file}`), { recursive: true }),
				fs.writeFileString(`${project}/${file}`, text),
			);

		yield* sh(
			run,
			`git init -q -b main && git init -q --bare ../origin.git && git remote add origin ${project}/../origin.git`,
		);
		yield* Effect.forEach(history, ({ subject, files }, index) =>
			Effect.andThen(
				Effect.forEach(Rec.toEntries(files), write),
				sh(
					run,
					`at=$(date -R -d '-${String((history.length - index) * 9)} hours') && git add -A && GIT_COMMITTER_DATE="$at" git commit -q --date="$at" -m '${subject}'`,
				),
			),
		);
		yield* sh(run, "git push -q -u origin main");

		return Str.trim((yield* sh(run, "git rev-parse HEAD")).output);
	});

/** What the run came to: the sessions `watch` returned, the root's last reply if it settled idle, and the files edited. */
interface Observed {
	readonly sessions: Sessions;
	readonly reply: Option.Option<string>;
	readonly files: ReadonlyArray<string>;
}

const spend = (sessions: Sessions) =>
	Arr.reduce(
		Arr.flatMap(everyone(sessions), ({ entries }) => Arr.getSomes(Arr.map(entries, assistantOf))),
		{ dollars: 0, tokens: 0 },
		(sum, { usage }) => ({ dollars: sum.dollars + usage.cost.total, tokens: sum.tokens + usage.totalTokens }),
	);

const account = (run: Run, { sessions, reply, files }: Observed) =>
	Effect.gen(function* () {
		const { dollars, tokens } = spend(sessions);
		const count = String(sessions.delegates.length + 1);
		const known = yield* guides(run);

		const readBy = (session: Session) =>
			Arr.join(
				Arr.flatMap(known, ({ guide, line }) => (holds(session, line) ? [guide] : [])),
				", ",
			) || "no skill or playbook";

		yield* run.say(
			`spent ${String(tokens)} tokens, $${dollars.toFixed(2)} at catalog prices, over ${count} sessions`,
		);
		yield* run.say(`root read ${readBy(sessions.root)}`);
		yield* Effect.forEach(sessions.delegates, (session) => run.say(`delegate ${session.id} read ${readBy(session)}`));
		yield* run.say(`files edited: ${Arr.join(files, ", ") || "none"}`);
		yield* run.say(
			Option.match(reply, {
				onNone: () => "the root never settled idle",
				onSome: (text) => `root's last reply:\n${text}`,
			}),
		);
	});

interface Watched {
	readonly sessions: Sessions;
	readonly files: ReadonlyArray<string>;
}

/**
 * Reads `sessions`, then `files`, until a look finds a file `stopAt` matches edited or the root settled idle. On an edit
 * it returns the sessions of the look before, which predate the edit because that look found none after reading them.
 * `start` is the sessions before the human's message.
 */
export const watch = <Failure>({
	start,
	sessions,
	files,
	stopAt,
}: {
	readonly start: Sessions;
	readonly sessions: Effect.Effect<Sessions, Failure>;
	readonly files: Effect.Effect<ReadonlyArray<string>, Failure>;
	readonly stopAt: (file: string) => boolean;
}) => {
	const look = (clean: Sessions): Effect.Effect<Watched, Failure> =>
		Effect.gen(function* () {
			const now = yield* sessions;
			const edited = yield* files;

			if (Arr.some(edited, stopAt)) {
				return { sessions: clean, files: edited };
			}

			return Option.isSome(settledReply(now.root)) ? { sessions: now, files: edited } : yield* look(now);
		});

	return look(start);
};

/**
 * Sends `request` as the human's one message, then looks every 5 seconds until the root settles idle holding no work or,
 * given `stopAt`, until a file it matches is edited, whichever comes first, per `watch`. Prints what the run spent, which
 * skills and playbooks each session read, the files edited and the root's last reply, as of the sessions `watch` returns.
 */
export const observe = ({
	run,
	base,
	request,
	within,
	stopAt,
}: {
	readonly run: Run;
	readonly base: string;
	readonly request: string;
	readonly within: Duration.Input;
	readonly stopAt?: (file: string) => boolean;
}) =>
	Effect.gen(function* () {
		const sessions = run.waitFor("the sessions", "1 minute", Option.some);
		const settling = `the root settles idle within ${Duration.format(Duration.fromInputUnsafe(within))}`;

		const watching = watch({
			start: yield* sessions,
			sessions: Effect.andThen(Effect.sleep("5 seconds"), sessions),
			files: filesChangedSince({ run, base }),
			stopAt: stopAt ?? (() => false),
		}).pipe(
			Effect.timeoutOrElse({
				duration: within,
				orElse: () => Effect.andThen(run.check(false, settling), Effect.never),
			}),
		);

		const watched = yield* Effect.raceFirst(Effect.andThen(run.root.prompt(request, within), Effect.never), watching);
		const observed = { ...watched, reply: settledReply(watched.sessions.root) };

		yield* account(run, observed);

		return observed;
	});
