import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Str from "effect/String";

import { ScenarioFailed, SetupFailed } from "./failed.ts";
import { type Reporter, reporter } from "./report.ts";
import { type Root, type RootProcess, type SpawnRequest, type Spawned, spawnIn, startRoot } from "./run/index.ts";
import { inService, leftAlone, runAsService, stdinEnded } from "./service/index.ts";
import { readSessions, type Sessions, tookSetup } from "./sessions/index.ts";
import { type Exited, type Layout, layoutOf, openWorld, type Setup, setupOf } from "./world/index.ts";

export type { ScenarioFailed } from "./failed.ts";

export type { Image, Message } from "./run/index.ts";

export type { Root } from "./run/index.ts";

export type { SpawnRequest, Spawned } from "./run/index.ts";

export type { Loaded, Session, Sessions } from "./sessions/index.ts";

export type { Exited } from "./world/index.ts";

export interface Scenario<Failure> extends Setup {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly model: `${string}/${string}`;
	readonly contextWindow?: number;
	readonly play: (run: Run) => Effect.Effect<void, Failure, Allowed>;
}

export interface Run {
	readonly pi: { readonly version: string; readonly path: string };
	readonly agentDir: string;
	readonly home: string;
	readonly root: Root;
	readonly waitFor: <Found>(
		what: string,
		within: Duration.Input,
		find: (sessions: Sessions) => Option.Option<Found>,
	) => Effect.Effect<Found, ScenarioFailed>;
	readonly exec: (argv: readonly [string, ...Array<string>]) => Effect.Effect<Exited, ScenarioFailed>;
	readonly say: (value: Schema.Json) => Effect.Effect<void>;
	readonly check: (condition: boolean, claim: string) => Effect.Effect<void, ScenarioFailed>;
	readonly spawn: (request: SpawnRequest) => Effect.Effect<Spawned, ScenarioFailed, Scope.Scope>;
}

type Allowed = FileSystem.FileSystem | Path.Path;

const check = (condition: boolean, claim: string): Effect.Effect<void, ScenarioFailed> =>
	condition ? Effect.void : Effect.fail(ScenarioFailed.make({ message: claim }));

const nameOf = (entry: string) => Str.replace(/^(?:.*\/)?(?<name>[^/]+?)(?:\.scenario)?\.ts$/u, "$<name>")(entry);

const stampOf = Str.replace(
	/^(?<year>\d{4})-(?<month>\d\d)-(?<day>\d\d)T(?<hour>\d\d):(?<minute>\d\d):(?<second>\d\d).*$/u,
	"$<year>$<month>$<day>-$<hour>$<minute>$<second>",
);

const messageOf = (cause: Cause.Cause<unknown>) => {
	const error = Cause.squash(cause);

	return Predicate.isError(error) ? error.message : String(error);
};

const verdictOf = <Value, Failure>(name: string, exit: Exit.Exit<Value, Failure>, seconds: number) => {
	if (Exit.isSuccess(exit)) {
		return `pass ${name} in ${String(seconds)} s`;
	}

	if (Cause.hasInterruptsOnly(exit.cause)) {
		return `interrupted ${name}`;
	}

	return Option.exists(Cause.findErrorOption(exit.cause), Schema.is(SetupFailed))
		? `broken ${name}: ${messageOf(exit.cause)}`
		: `fail ${name}: ${messageOf(exit.cause)}`;
};

const waiting =
	(sessions: Effect.Effect<Sessions, ScenarioFailed>, root: RootProcess, report: Reporter) =>
	<Found>(what: string, within: Duration.Input, find: (sessions: Sessions) => Option.Option<Found>) => {
		const poll = (): Effect.Effect<Found, ScenarioFailed> =>
			Effect.flatMap(sessions, (all) =>
				Option.match(find(all), {
					onSome: Effect.succeed,
					onNone: () => Effect.andThen(Effect.sleep("1 second"), poll()),
				}),
			);

		const timedOut = ScenarioFailed.make({
			message: `timed out after ${String(Duration.toSeconds(within))} s waiting for ${what}`,
		});

		return poll().pipe(
			Effect.timeoutOrElse({ duration: within, orElse: () => Effect.fail(timedOut) }),
			(polling) => Effect.raceFirst(polling, root.exited),
			Effect.tap(() => report.progress(`found ${what}`)),
		);
	};

const playIn = <Failure>({
	spec,
	layout,
	report,
}: {
	readonly spec: Scenario<Failure>;
	readonly layout: Layout;
	readonly report: Reporter;
}) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const setup = setupOf(spec);
		const world = yield* openWorld({ layout, setup, own: spec.env });

		yield* report.say(`pi ${world.pi.version} ${world.pi.path}`);
		yield* report.say(`agent ${world.agentDir}`);

		const root = yield* startRoot({ world, model: spec.model, progress: report.progress });
		const sessions = readSessions({ root: root.session, sessionDir: layout.sessions, probeDir: layout.probe });

		yield* tookSetup(Effect.provideService(sessions, FileSystem.FileSystem, fs), {
			model: spec.model,
			contextWindow: spec.contextWindow,
			scenarioModels: spec.models,
			setup,
			runCoreSocket: layout.socket,
		});

		const run: Run = {
			pi: world.pi,
			agentDir: world.agentDir,
			home: layout.home,
			root,
			waitFor: waiting(Effect.provideService(sessions, FileSystem.FileSystem, fs), root, report),
			exec: world.exec,
			say: report.say,
			check,
			spawn: yield* spawnIn(world, spec.model),
		};

		yield* Effect.raceFirst(spec.play(run), root.exited);
	}).pipe(Effect.scoped);

const freshLayout = Effect.fn("freshLayout")(function* (name: string) {
	const fs = yield* FileSystem.FileSystem;
	const tmp = yield* Config.String("TMPDIR").pipe(Config.withDefault("/tmp"));
	const now = yield* DateTime.now;
	const tag = yield* Random.nextIntBetween(0, 2 ** 24);

	yield* fs.makeDirectory(`${tmp}/pi-driver`, { recursive: true, mode: 0o700 });

	const { uid } = yield* fs.stat(`${tmp}/pi-driver`);

	if (!Option.contains(uid, process.getuid?.() ?? -1)) {
		return yield* SetupFailed.make({ message: `${tmp}/pi-driver belongs to another user` });
	}

	return layoutOf({
		tmp,
		name,
		stamp: now.pipe(DateTime.formatIso, stampOf),
		pid: process.pid,
		tag: Str.padStart(6, "0")(tag.toString(16)),
	});
});

const played = <Failure>({ name, spec }: { readonly name: string; readonly spec: Scenario<Failure> }) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const layout = yield* freshLayout(name).pipe(
			Effect.tap((fresh) => fs.makeDirectory(fresh.folder, { recursive: true, mode: 0o700 })),
			Effect.catchTag("PlatformError", (error) => Effect.fail(SetupFailed.make({ message: error.message }))),
			Effect.tapError((error) => Console.log(`broken ${name}: ${error.message}`)),
		);

		const report = yield* reporter(layout.report);

		yield* report.say(`scenario ${name}`);
		yield* report.say(`run ${layout.folder}`);
		yield* playIn({ spec, layout, report }).pipe(
			Effect.exit,
			Effect.flatMap((exit) => Effect.andThen(leftAlone(layout), exit)),
			Effect.onExit((exit) =>
				Effect.flatMap(report.elapsed, (seconds) =>
					Effect.andThen(report.say(verdictOf(name, exit, seconds)), report.say(`evidence ${layout.folder}`)),
				),
			),
		);
	});

const codeOf = <Value, Failure>(exit: Exit.Exit<Value, Failure>): number => {
	if (Exit.isSuccess(exit)) {
		return 0;
	}

	if (Cause.hasInterruptsOnly(exit.cause)) {
		return 130;
	}

	return Option.exists(Cause.findErrorOption(exit.cause), Schema.is(SetupFailed)) ? 2 : 1;
};

export const scenario = <Failure>(spec: Scenario<Failure>): void => {
	const name = nameOf(process.argv[1] ?? "scenario");
	const program = Effect.raceFirst(played({ name, spec }), stdinEnded);

	if (inService(spec.env)) {
		NodeRuntime.runMain(Effect.provide(program, NodeServices.layer), {
			disableErrorReporting: true,
			teardown: (exit, onExit) => {
				onExit(codeOf(exit));
			},
		});
	} else {
		runAsService({ name, argv: process.argv, env: spec.env });
	}
};
