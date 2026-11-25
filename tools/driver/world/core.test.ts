import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schedule from "effect/Schedule";
import * as Str from "effect/String";
import * as TestClock from "effect/testing/TestClock";

import { eventually } from "#src/primitives/eventually.ts";
import { execIn, ran, startCore } from "./core.ts";
import { layoutOf } from "./world.ts";

const path = Bun.env["PATH"] ?? "";

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const killedAtTheEnd = (pid: number) => Effect.addFinalizer(() => Effect.sync(() => isAlive(pid) && process.kill(pid)));

test("interrupting ran ends a command that ignores SIGTERM", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const pidFile = `${tmp}/command.pid`;

			const command = {
				argv: [
					"sh",
					"-c",
					`trap '' TERM; echo $$ >${pidFile}.part && mv ${pidFile}.part ${pidFile}; exec sleep 30`,
				] as const,
				env: { PATH: path },
				cwd: "/",
			};

			const running = yield* Effect.forkChild(ran(command));

			yield* eventually(fs.exists(pidFile), "5 seconds");

			const pid = yield* Effect.map(fs.readFileString(pidFile), Number);

			yield* Fiber.interrupt(running);

			expect(isAlive(pid)).toBe(false);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));

test("ran's output holds what the command printed to stdout and to stderr", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { output } = yield* ran({ argv: ["sh", "-c", "echo out; echo err >&2"], env: { PATH: path }, cwd: "/" });

			expect(output).toContain("out\n");
			expect(output).toContain("err\n");
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("ran signals nothing once a command exits non-zero, so what it left running lives on", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { output } = yield* ran({
				argv: ["sh", "-c", "sleep 30 </dev/null >/dev/null 2>&1 & echo $!; exit 1"],
				env: { PATH: path },
				cwd: "/",
			});

			const left = Number(Str.trim(output));

			yield* killedAtTheEnd(left);

			expect(isAlive(left)).toBe(true);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));

test("run.exec returns the code of a command that fails", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const exec = yield* execIn({ env: { PATH: path }, cwd: "/" });

			const exited = yield* exec(["sh", "-c", "exit 3"]);

			expect(exited).toEqual({ code: ChildProcessSpawner.ExitCode(3), output: "" });
		}).pipe(Effect.provide(NodeServices.layer)),
	));

const withTestClock = Layer.merge(NodeServices.layer, TestClock.layer());

test("run.exec fails the scenario when a command runs past a minute", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const exec = yield* execIn({ env: { PATH: path }, cwd: "/" });
			const running = yield* Effect.forkChild(exec(["sleep", "600"]));

			yield* TestClock.adjust("1 minute");

			const failure = yield* Fiber.join(running).pipe(Effect.flip);

			expect(failure._tag).toBe("ScenarioFailed");
		}).pipe(Effect.provide(withTestClock)),
	));

const fakeCore = `#!/bin/sh
echo $$ >"$FAKE_DIR/core.pid"
sleep 30 </dev/null >/dev/null 2>&1 &
echo $! >"$FAKE_DIR/left.pid"
mkdir -p "\${HC_SOCKET%/*}" && : >"$HC_SOCKET"
exit 1
`;

test("startCore signals nothing once the core exits non-zero, so what it left running lives on", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const layout = layoutOf({ tmp, name: "core", stamp: "t", pid: process.pid, tag: "0abc12" });
			const env = { PATH: `${tmp}/bin:/usr/bin:/bin`, HC_SOCKET: layout.socket, FAKE_DIR: tmp };

			yield* fs.makeDirectory(`${tmp}/bin`);
			yield* fs.makeDirectory(layout.folder, { recursive: true });
			yield* fs.writeFileString(`${tmp}/bin/herdr-core`, fakeCore, { mode: 0o755 });
			yield* startCore({ layout, env });
			yield* eventually(fs.exists(`${tmp}/left.pid`), "5 seconds");

			const core = yield* Effect.map(fs.readFileString(`${tmp}/core.pid`), Number);
			const left = yield* Effect.map(fs.readFileString(`${tmp}/left.pid`), Number);

			yield* killedAtTheEnd(left);
			yield* eventually(
				Effect.sync(() => !isAlive(core)),
				"5 seconds",
			);

			expect(isAlive(left)).toBe(true);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));

const coreIn = (tmp: string) => {
	const layout = layoutOf({ tmp, name: "core", stamp: "t", pid: process.pid, tag: "0abc12" });

	const env = {
		PATH: path,
		HOME: layout.home,
		XDG_RUNTIME_DIR: layout.runtime,
		HC_SESSION: layout.coreSession,
		HC_SOCKET: layout.socket,
	};

	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		yield* Effect.forEach([layout.folder, layout.home, layout.runtime], (folder) =>
			fs.makeDirectory(folder, { recursive: true }),
		);

		return { layout, env };
	});
};

test.skipIf(Bun.which("hc") === null)("startCore returns once the core's socket exists", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const { layout, env } = yield* coreIn(tmp);

			const socketAtStart = yield* Effect.gen(function* () {
				yield* startCore({ layout, env });

				return yield* fs.exists(layout.socket);
			}).pipe(Effect.scoped);

			expect(socketAtStart).toBe(true);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);

test.skipIf(Bun.which("hc") === null)("closing the core's scope ends the terminals it runs", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const { layout, env } = yield* coreIn(tmp);
			const pidFile = `${tmp}/terminal.pid`;

			const terminal = yield* Effect.gen(function* () {
				yield* startCore({ layout, env });
				yield* ran({ argv: ["hc", "run", "--bg", `echo $$ >${pidFile}; exec sleep 600`], env, cwd: layout.folder });
				yield* fs
					.exists(pidFile)
					.pipe(
						Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("50 millis") }),
						Effect.timeout("5 seconds"),
					);

				return yield* Effect.map(fs.readFileString(pidFile), Number);
			}).pipe(Effect.scoped);

			expect(isAlive(terminal)).toBe(false);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	),
);
