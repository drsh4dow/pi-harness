import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";

import { eventually } from "#src/primitives/eventually.ts";
import { ran, startCore } from "./core.ts";
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

test(
	"interrupting ran ends a command that ignores SIGTERM",
	() =>
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
		),
	15_000,
);

test.skipIf(Bun.which("hc") === null)("closing the core's scope ends the terminals it runs", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const layout = layoutOf({ tmp, name: "core", stamp: "t", pid: process.pid, tag: "0abc12" });

			const env = {
				PATH: path,
				HOME: layout.home,
				XDG_RUNTIME_DIR: layout.runtime,
				HC_SESSION: layout.coreSession,
				HC_SOCKET: layout.socket,
			};

			const pidFile = `${tmp}/terminal.pid`;

			yield* Effect.forEach([layout.folder, layout.home, layout.runtime], (folder) =>
				fs.makeDirectory(folder, { recursive: true }),
			);

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
