import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import {
	holdPlace,
	type Holder,
	keptBytes,
	queuesFolder,
	type Ran,
	type Receipt,
	receiptOf,
	receiptsFolder,
	recordReceipt,
	replay,
	runShown,
	type Wait,
	type Worktree,
	worktreeAt,
} from "#src/client/checks/index.ts";

/** One check slot per four cores, and never fewer than two. */
export const checkSlotsFor = (cores: number) => Math.max(2, Math.floor(cores / 4));

const receiptKey = ({ tree, root, prefix }: Worktree, command: ReadonlyArray<string>) => {
	const bytes = new TextEncoder().encode(Arr.join([tree, root, prefix, ...command], "\0"));

	return Effect.map(
		Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)),
		(digest) => Buffer.from(digest).toString("hex"),
	);
};

const holdersText = (holders: ReadonlyArray<Holder>) =>
	Arr.join(
		Arr.map(holders, ({ command, cwd, pid }) => `\`${command}\` in ${cwd} (pid ${String(pid)})`),
		"; ",
	);

/** Holds a place in the queue for the scope, saying when it waits and, once it gets a place, how long it waited. */
const queued = ({
	what,
	folder,
	places,
	holder,
}: {
	readonly what: string;
	readonly folder: string;
	readonly places: number;
	readonly holder: Omit<Holder, "pid">;
}) =>
	Effect.gen(function* () {
		const since = yield* Clock.currentTimeMillis;
		let waited = false;

		const onWait = ({ holders, ahead }: Wait) => {
			waited = true;

			return Console.error(`${what}: queued, ${String(ahead)} ahead of this one. Running: ${holdersText(holders)}`);
		};

		yield* holdPlace({ folder, places, holder, onWait });

		if (waited) {
			const now = yield* Clock.currentTimeMillis;

			yield* Console.error(`${what}: got a place after ${String(Math.round((now - since) / 1000))} s`);
		}
	});

export interface CheckRun {
	readonly command: Arr.NonEmptyReadonlyArray<string>;
	readonly cwd: string;
	readonly home: string;
	readonly slots: number;
	/** A leaf's check runs at a lower CPU priority. */
	readonly nice: boolean;
	/** Run it even when a receipt says it passed on this tree. */
	readonly fresh: boolean;
}

const idOf = Str.slice(0, 12);

const shellWord = (word: string) =>
	/^[\w@%+=:,./-]+$/u.test(word) ? word : `'${Str.replaceAll("'", String.raw`'\''`)(word)}'`;

/** The command as a shell would take it. */
const shownOf = (command: ReadonlyArray<string>) => Arr.join(Arr.map(command, shellWord), " ");

const served = (key: string, { command, stdout, stderr, passedAt, seconds }: Receipt) =>
	Effect.andThen(
		replay({ stdout, stderr }),
		Console.error(
			`check: receipt ${idOf(key)}: \`${shownOf(command)}\` passed on this tree at ${passedAt} in ${String(seconds)} s, so it did not run again. \`check --fresh -- ${shownOf(command)}\` runs it again.`,
		),
	);

/** Records a receipt for a pass, unless the tree changed while the check ran or its output is too long to keep. */
const recordPass = (
	{ home, command, cwd }: CheckRun,
	{
		key,
		worktree,
		seconds,
		ran,
	}: { readonly key: string; readonly worktree: Worktree; readonly seconds: number; readonly ran: Ran },
) =>
	Effect.gen(function* () {
		const after = yield* worktreeAt(cwd);

		if (Option.getOrUndefined(after)?.tree !== worktree.tree) {
			return yield* Console.error("check: passed, but the tree changed while it ran, so it has no receipt.");
		}

		if (Option.isNone(ran.output)) {
			return yield* Console.error(
				`check: passed, but printed over ${String(keptBytes)} bytes, so it has no receipt.`,
			);
		}

		const finished = yield* Clock.currentTimeMillis;
		const passedAt = DateTime.formatIso(DateTime.makeUnsafe(finished));

		yield* recordReceipt(receiptsFolder(home))(key, { ...worktree, ...ran.output.value, command, passedAt, seconds });

		return yield* Console.error(
			`check: receipt ${idOf(key)}: \`${shownOf(command)}\` passed on tree ${idOf(worktree.tree)} in ${String(seconds)} s.`,
		);
	});

const runInSlot = ({ command, cwd, home, slots, nice }: CheckRun) => {
	const argv: Arr.NonEmptyReadonlyArray<string> = nice ? ["nice", "-n", "10", ...command] : command;
	const holder = { command: shownOf(command), cwd };
	const place = queued({ what: "check", folder: `${queuesFolder(home)}/check-slots`, places: slots, holder });

	const timed = Effect.timed(runShown({ command: argv, cwd }));

	return Effect.scoped(Effect.andThen(place, timed));
};

/** Prints the receipt of the same command on the same tree, or else runs the check and records a pass. */
const checkedOn = (run: CheckRun, worktree: Worktree) =>
	Effect.gen(function* () {
		const key = yield* receiptKey(worktree, run.command);
		const kept = run.fresh ? Option.none() : yield* receiptOf(receiptsFolder(run.home))(key);

		if (Option.isSome(kept)) {
			return yield* Effect.as(served(key, kept.value), 0);
		}

		const [took, ran] = yield* runInSlot(run);
		const seconds = Math.round(Duration.toMillis(took) / 100) / 10;

		if (ran.exitCode === 0) {
			yield* recordPass(run, { key, worktree, seconds, ran });
		}

		return ran.exitCode;
	});

/**
 * Runs a check in one of the machine's check slots, unless the same command already passed on the same tree; then it
 * prints that receipt instead. A pass records a receipt when the tree is still the one it started on. Its exit code is
 * the check's. Outside a git worktree it always runs and records nothing.
 */
export const runCheck = (run: CheckRun) =>
	Effect.flatMap(worktreeAt(run.cwd), (worktree) =>
		Option.match(worktree, {
			onNone: () => Effect.map(runInSlot(run), ([, { exitCode }]) => exitCode),
			onSome: (found) => checkedOn(run, found),
		}),
	);

export interface QueueRun {
	readonly name: string;
	readonly places: number;
	readonly command: Arr.NonEmptyReadonlyArray<string>;
	readonly cwd: string;
	readonly home: string;
}

/** Runs the command once it holds one of the named queue's places, first come first served. Its exit code is the command's. */
export const runQueued = ({ name, places, command, cwd, home }: QueueRun) => {
	const holder = { command: shownOf(command), cwd };
	const place = queued({ what: `queue ${name}`, folder: `${queuesFolder(home)}/${name}`, places, holder });

	const ran = Effect.map(runShown({ command, cwd }), ({ exitCode }) => exitCode);

	return Effect.scoped(Effect.andThen(place, ran));
};
