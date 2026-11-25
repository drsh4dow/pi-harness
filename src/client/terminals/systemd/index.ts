import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

import type { RunSpec } from "#src/client/terminals/hc/index.ts";

export class Slices extends Context.Service<
	Slices,
	{
		readonly wrap: (spec: RunSpec) => RunSpec;
		readonly stop: (ref: string) => Effect.Effect<void>;
		readonly stopAll: Effect.Effect<void>;
	}
>()("pi-harness/client/terminals/systemd/Slices") {}

class NoUserManager extends Schema.TaggedError<NoUserManager, { readonly brand: unique symbol }>()("NoUserManager", {
	message: Schema.String,
}) {}

const noUserManager = (output: string) =>
	NoUserManager.make({
		message: `owned-work runs each delegate in a systemd user scope, and systemd-run --user failed: ${output}`,
	});

export interface SliceOptions {
	readonly slice: string;
	readonly rootPid: Option.Option<number>;
}

const notLoaded = 5;

const stopGrace = "5s";

const unitOf = (slice: string, ref: string) => `${slice}-${Str.replaceAll("-", "")(ref)}`;

const finished = (handle: ChildProcessSpawner.ChildProcessHandle) =>
	Effect.all(
		{ code: handle.exitCode, output: handle.all.pipe(Stream.decodeText, Stream.mkString) },
		{ concurrency: 2 },
	);

interface UserCommand {
	readonly program: "systemctl" | "systemd-run";
	readonly args: ReadonlyArray<string>;
	readonly succeedsOn: ReadonlyArray<number>;
}

const systemd = (
	spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
	{ program, args, succeedsOn }: UserCommand,
) =>
	spawner.spawn(ChildProcess.make(program, ["--user", ...args])).pipe(
		Effect.flatMap(finished),
		Effect.scoped,
		Effect.mapError((error) => error.message),
		Effect.filterOrFail(
			({ code }) => succeedsOn.includes(code),
			({ output }) => Str.trim(output),
		),
	);

const stopUnit = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], unit: string) =>
	Effect.ignore(
		systemd(spawner, { program: "systemctl", args: ["stop", "--no-block", unit], succeedsOn: [0, notLoaded] }),
		{ log: "Warn" },
	);

export const stopRoot = (slice: string) =>
	Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) => stopUnit(spawner, `${slice}.service`));

export const ownCgroup = Effect.flatMap(FileSystem.FileSystem, (fs) =>
	Effect.orElseSucceed(fs.readFileString("/proc/self/cgroup"), () => ""),
);

const isActive = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], unit: string) =>
	Effect.isSuccess(systemd(spawner, { program: "systemctl", args: ["is-active", "--quiet", unit], succeedsOn: [0] }));

const watchRoot = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"], slice: string, pid: number) => {
	const service = [
		"--quiet",
		"--collect",
		`--unit=${slice}`,
		`--property=ExecStopPost=systemctl --user stop --no-block ${slice}.slice`,
		"--",
		"tail",
		`--pid=${String(pid)}`,
		"-f",
		"/dev/null",
	];

	const start = Effect.mapError(
		systemd(spawner, { program: "systemd-run", args: service, succeedsOn: [0] }),
		noUserManager,
	);

	return Effect.flatMap(isActive(spawner, `${slice}.service`), (running) =>
		running ? Effect.void : Effect.asVoid(start),
	);
};

export const slicesLayer = ({
	slice,
	rootPid,
}: SliceOptions): Layer.Layer<Slices, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Layer.effect(
		Slices,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

			yield* Effect.orDie(Effect.forEach(Option.toArray(rootPid), (pid) => watchRoot(spawner, slice, pid)));

			return Slices.of({
				wrap: (spec) => {
					const unit = unitOf(slice, spec.ref);

					return {
						...spec,
						argv: [
							"systemd-run",
							"--user",
							"--scope",
							"--quiet",
							"--collect",
							"--expand-environment=no",
							`--property=TimeoutStopSec=${stopGrace}`,
							`--slice=${unit}.slice`,
							`--unit=${unit}`,
							"--",
							...spec.argv,
						],
						env: { ...spec.env, PI_OWNED_WORK_SLICE: unit },
					};
				},
				stop: (ref) => stopUnit(spawner, `${unitOf(slice, ref)}.slice`),
				stopAll: Option.isSome(rootPid) ? stopUnit(spawner, `${slice}.service`) : Effect.void,
			});
		}),
	);
