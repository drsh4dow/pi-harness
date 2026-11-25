import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { type RunSpec, terminalNameOf } from "#src/client/terminals/hc/index.ts";
import { ownCgroup, Slices, slicesLayer, stopRoot } from "./index.ts";

type Argv = ReadonlyArray<ChildProcess.StandardCommand["args"][number]>;

const slice = "pi-ow-0a1b2c3d";

const job: RunSpec = {
	ref: "delegate-3",
	name: terminalNameOf("review"),
	labels: {},
	argv: ["pi"],
	cwd: "/",
	env: {},
};

const inactive = 3;

const rootOnFakeSystemd = ({ watcherRunning }: { readonly watcherRunning: boolean }) => {
	const commands: Array<Argv> = [];

	const spawner = Layer.effect(
		ChildProcessSpawner.ChildProcessSpawner,
		Effect.map(ChildProcessSpawner.ChildProcessSpawner, (real) =>
			ChildProcessSpawner.make((command) =>
				Effect.suspend(() => {
					const argv = ChildProcess.isStandardCommand(command) ? [command.command, ...command.args] : [];
					const code = argv.includes("is-active") && !watcherRunning ? inactive : 0;

					commands.push(argv);

					return real.spawn(ChildProcess.make("sh", ["-c", `exit ${String(code)}`]));
				}),
			),
		),
	);

	const systemd = Layer.provideMerge(spawner, NodeServices.layer);
	const slices = slicesLayer({ slice, rootPid: Option.some(4242) });

	return { commands, layer: Layer.provideMerge(slices, systemd) };
};

const stopOf = (unit: string) => ["systemctl", "--user", "stop", "--no-block", unit];

test("stop ends the slice wrap runs the job in, one level below the root's slice", () => {
	const { commands, layer } = rootOnFakeSystemd({ watcherRunning: false });

	return Effect.runPromise(
		Effect.gen(function* () {
			const slices = yield* Slices;
			const { argv } = slices.wrap(job);

			yield* slices.stop(job.ref);

			expect(argv).toContain(`--slice=${slice}-delegate3.slice`);
			expect(commands.at(-1)).toEqual(stopOf(`${slice}-delegate3.slice`));
		}).pipe(Effect.provide(layer)),
	);
});

test("a stopped job gets the 5 s that pi.exec waits between SIGTERM and SIGKILL", () => {
	const { layer } = rootOnFakeSystemd({ watcherRunning: false });

	return Effect.runPromise(
		Effect.gen(function* () {
			const slices = yield* Slices;

			expect(slices.wrap(job).argv).toContain("--property=TimeoutStopSec=5s");
		}).pipe(Effect.provide(layer)),
	);
});

test("a root's layer starts a watcher that waits on the root's pid, then stops the root's slice", () => {
	const { commands, layer } = rootOnFakeSystemd({ watcherRunning: false });

	return Effect.runPromise(
		Effect.gen(function* () {
			yield* Slices;

			expect(commands).toContainEqual([
				"systemd-run",
				"--user",
				"--quiet",
				"--collect",
				`--unit=${slice}`,
				`--property=ExecStopPost=systemctl --user stop --no-block ${slice}.slice`,
				"--",
				"tail",
				"--pid=4242",
				"-f",
				"/dev/null",
			]);
		}).pipe(Effect.provide(layer)),
	);
});

test("a second layer while the root's watcher runs starts no second watcher", () => {
	const { commands, layer } = rootOnFakeSystemd({ watcherRunning: true });

	return Effect.runPromise(
		Effect.gen(function* () {
			yield* Slices;

			expect(Arr.filter(commands, ([program]) => program === "systemd-run")).toEqual([]);
		}).pipe(Effect.provide(layer)),
	);
});

test("stopAll and stopRoot stop the root's watcher", () => {
	const { commands, layer } = rootOnFakeSystemd({ watcherRunning: false });

	return Effect.runPromise(
		Effect.gen(function* () {
			const slices = yield* Slices;

			yield* slices.stopAll;
			yield* stopRoot(slice);

			expect(commands.slice(-2)).toEqual([stopOf(`${slice}.service`), stopOf(`${slice}.service`)]);
		}).pipe(Effect.provide(layer)),
	);
});

const unreadable = FileSystem.layerNoop({});

test("ownCgroup is empty where /proc/self/cgroup cannot be read", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const cgroup = yield* ownCgroup;

			expect(cgroup).toBe("");
		}).pipe(Effect.provide(unreadable)),
	));
