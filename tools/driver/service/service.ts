/**
 * Every process of a run lives in one transient systemd user service. `bun <file>` starts the driver again as that
 * service's main process, its stdin a pipe from the process the human started. However that process ends, the pipe
 * closes and the driver in the service ends the run as if interrupted. Once the driver in the service exits, however
 * it exits, systemd kills every process left in the service's cgroup. The driver signals only its own children that it
 * has not yet waited for, through Effect's spawner, so no other process can hold their pids.
 *
 * A pid namespace would tie the run to the driver more tightly, but `systemd-run --user`, which owned-work starts
 * every delegate with, refuses the user manager from inside one.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeStream from "@effect/platform-node/NodeStream";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type * as Runtime from "effect/Runtime";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

import { guardedFolders } from "./tripwire.ts";

const marker = "PI_DRIVER_SERVICE";

export const inService = (env: Readonly<Record<string, string | undefined>>): boolean => env[marker] === "1";

/**
 * Interrupts once stdin ends: the process the human started closed it, or died. It closes stdin when it ends or is
 * interrupted, so an open stdin never keeps the driver's process alive.
 */
export const stdinEnded = Stream.runDrain(NodeStream.fromReadable({ evaluate: () => process.stdin })).pipe(
	Effect.ignore,
	Effect.andThen(Effect.interrupt),
);

/**
 * Pure. The `systemd-run` command that runs `argv` as the run's service, in the caller's folder and environment, with
 * the session and state folders under `home` read-only to every process in it. A folder `home` lacks is skipped, so a
 * fresh home still runs.
 */
const serviceArgv = (command: {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly argv: ReadonlyArray<string>;
	readonly home: string;
}) => [
	"systemd-run",
	"--user",
	"--pipe",
	"--quiet",
	"--collect",
	"--same-dir",
	"--property=KillSignal=SIGKILL",
	...Arr.map(guardedFolders(command.home), (folder) => `--property=ReadOnlyPaths=-${folder}`),
	...Arr.map(
		Arr.filter(Rec.keys(command.env), (key) => /^[A-Za-z_]\w*$/u.test(key)),
		(key) => `--setenv=${key}`,
	),
	`--setenv=${marker}=1`,
	"--",
	...command.argv,
];

/** Why `argv` did not run to a clean exit, if it did not. */
const failureOf = (argv: Array<string>) =>
	Effect.try({ try: () => Bun.spawn(argv, { stdout: "ignore", stderr: "pipe" }), catch: String }).pipe(
		Effect.flatMap((probe) =>
			Effect.all({ code: Effect.promise(() => probe.exited), stderr: Effect.promise(() => probe.stderr.text()) }),
		),
		Effect.filterOrFail(
			({ code }) => code === 0,
			({ stderr }) => Str.trim(stderr),
		),
		Effect.flip,
		Effect.option,
	);

/** The process exit code: the service's, 130 when interrupted, 1 on a defect. */
const exitCode: Runtime.Teardown = (exit, onExit) => {
	if (Exit.isSuccess(exit)) {
		onExit(Predicate.isNumber(exit.value) ? exit.value : 1);
	} else {
		onExit(Cause.hasInterruptsOnly(exit.cause) ? 130 : 1);
	}
};

export const runAsService = ({
	name,
	argv,
	env,
}: {
	readonly name: string;
	readonly argv: ReadonlyArray<string>;
	readonly env: Readonly<Record<string, string | undefined>>;
}) => {
	const home = env["HOME"];

	const program = Effect.gen(function* () {
		if (home === undefined) {
			yield* Console.log(
				`broken ${name}: the driver keeps your session and state folders read-only, and HOME is unset`,
			);

			return 2;
		}

		const command = serviceArgv({ env, argv, home });
		const failure = yield* failureOf([...Arr.takeWhile(command, (arg) => arg !== "--"), "--", "true"]);

		if (Option.isSome(failure)) {
			yield* Console.log(`broken ${name}: the driver runs a scenario as a systemd user service: ${failure.value}`);

			return 2;
		}

		const started = yield* Effect.acquireRelease(
			Effect.sync(() => Bun.spawn(command, { stdin: "pipe", stdout: "inherit", stderr: "inherit", detached: true })),
			(service) =>
				Effect.tryPromise({ try: () => Promise.resolve(service.stdin.end()), catch: String }).pipe(
					Effect.ignore,
					Effect.andThen(Effect.promise(() => service.exited)),
				),
		);

		return yield* Effect.promise(() => started.exited);
	}).pipe(Effect.scoped);

	NodeRuntime.runMain(program, { disableErrorReporting: true, teardown: exitCode });
};
