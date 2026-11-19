import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

/** Waits until every pid is gone, for at most `bound`. */
const goneWithin = (pids: ReadonlyArray<number>, bound: Duration.Input) =>
	Effect.sync(() => Arr.some(pids, isAlive)).pipe(
		Effect.repeat({ until: (alive) => !alive, schedule: Schedule.spaced("20 millis") }),
		Effect.timeout(bound),
		Effect.ignore,
	);

/** A run that prints the pids of a child in a session of its own and of an orphan, then exits 7 once its stdin ends. */
const run = ["sh", "-c", "setsid sleep 600 & echo $!; sh -c 'sleep 600 & echo $!'; cat >/dev/null; exit 7"];

const driverOf = ({ argv, home }: { readonly argv: ReadonlyArray<string>; readonly home: string | undefined }) =>
	Bun.spawn(
		[
			process.execPath,
			"-e",
			`import { runAsService } from "${import.meta.dirname}/service.ts"; runAsService({ name: "t", argv: process.argv.slice(1), env: process.env });`,
			...argv,
		],
		{ stdout: "pipe", env: { ...Bun.env, HOME: home } },
	);

const linesOf = (driver: ReturnType<typeof driverOf>) =>
	Stream.fromReadableStream({ evaluate: () => driver.stdout, onError: String }).pipe(
		Stream.decodeText,
		Stream.splitLines,
	);

/** The run's two pids, once it printed them. */
const pidsOf = (driver: ReturnType<typeof driverOf>) =>
	linesOf(driver).pipe(Stream.take(2), Stream.map(Number), Stream.runCollect);

test("a driver killed outright takes every process of its run with it, and only those", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const outsider = Bun.spawn(["sleep", "600"]);
			const driver = driverOf({ argv: run, home: Bun.env["HOME"] });
			const pids = yield* pidsOf(driver);

			driver.kill("SIGKILL");
			yield* goneWithin(pids, "2 seconds");

			expect([Arr.map(pids, isAlive), isAlive(outsider.pid)]).toEqual([[false, false], true]);
			outsider.kill();
		}),
	));

test("Ctrl-C ends the run through its stdin and waits for it", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const driver = driverOf({ argv: run, home: Bun.env["HOME"] });
			const pids = yield* pidsOf(driver);

			driver.kill("SIGINT");

			const code = yield* Effect.promise(() => driver.exited);

			yield* goneWithin(pids, "1 second");

			expect([code, Arr.map(pids, isAlive)]).toEqual([130, [false, false]]);
		}),
	));

test("a scenario where systemd-run cannot start a service exits 2 and says so", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const scenario = Bun.spawn([process.execPath, `${import.meta.dirname}/false-fact.scenario.ts`], {
				stdout: "pipe",
				env: { ...Bun.env, PATH: "/nonexistent" },
			});

			const output = yield* Effect.promise(() => scenario.stdout.text());
			const code = yield* Effect.promise(() => scenario.exited);

			expect(code).toBe(2);
			expect(output).toContain("broken false-fact: the driver runs a scenario as a systemd user service");
		}),
	));

const touchedIn = ({
	folders,
	files,
}: {
	readonly folders: ReadonlyArray<string>;
	readonly files: ReadonlyArray<string>;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });

		yield* Effect.forEach(folders, (folder) => fs.makeDirectory(`${home}/${folder}`, { recursive: true }));

		const driver = driverOf({ argv: ["touch", ...Arr.map(files, (file) => `${home}/${file}`)], home });

		yield* Effect.promise(() => driver.exited);

		return yield* Effect.forEach(files, (file) => fs.exists(`${home}/${file}`));
	}).pipe(Effect.scoped);

test("a run cannot write under its home's session or state folders, and can write beside them", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const touched = yield* touchedIn({
				folders: [".pi/agent/sessions", ".local/state"],
				files: [".pi/agent/sessions/x", ".local/state/x", ".pi/agent/x"],
			});

			expect(touched).toEqual([false, false, true]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("a run whose home lacks the session and state folders still runs", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const touched = yield* touchedIn({ folders: [], files: ["x"] });

			expect(touched).toEqual([true]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));
