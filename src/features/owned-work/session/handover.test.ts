import { expect, test } from "bun:test";

import type { SessionShutdownEvent } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Str from "effect/String";

import { PiCli, piHost } from "#src/client/pi/index.ts";
import { Slices } from "#src/client/terminals/index.ts";
import { Ledger, Transitions } from "#src/features/owned-work/ledger/index.ts";
import { MonotonicNanos } from "#src/features/owned-work/work.ts";
import { Inheritance, inheritanceOf, leave, rootSliceOf, stopStale, take } from "./handover.ts";

const state = Transitions.initial("root", 4, MonotonicNanos(0n));

const handover = Option.some({ agentKey: "old", stamp: 7, state });

const thisLoad = inheritanceOf({ agentKey: "new", stamp: 7 });

const rows = [
	{
		name: "a reload by the same ledger code takes the work over, under the old key",
		got: thisLoad("reload", handover),
		expected: Inheritance.Carried({ agentKey: "old", state }),
	},
	{
		name: "a reload that changed the ledger code stops the old work and starts under a new key",
		got: inheritanceOf({ agentKey: "new", stamp: 8 })("reload", handover),
		expected: Inheritance.Stale({ agentKey: "new", stale: "old" }),
	},
	{
		name: "a reload with nothing handed over starts fresh",
		got: thisLoad("reload", Option.none()),
		expected: Inheritance.Fresh({ agentKey: "new" }),
	},
	...Arr.map(["startup", "new", "resume", "fork"] as const, (reason) => ({
		name: `a ${reason} start ignores a handover and starts fresh`,
		got: thisLoad(reason, handover),
		expected: Inheritance.Fresh({ agentKey: "new" }),
	})),
];

test.each(rows)("$name", ({ got, expected }) => {
	expect(got).toEqual(expected);
});

const manager = "0::/user.slice/user-1000.slice/user@1000.service";

const slices = [
	{
		name: "a root started outside owned work gets a slice of its own",
		cgroup: `${manager}/app.slice/app-herdr-core.scope\n`,
		expected: "pi-ow-k1",
	},
	{
		name: "a root a watch started nests its slice in the watch's, so stopping the watch stops the root's delegates",
		cgroup: `${manager}/pi.slice/pi-ow.slice/pi-ow-ab.slice/pi-ow-ab-watch3.slice/pi-ow-ab-watch3.scope\n`,
		expected: "pi-ow-ab-watch3-k1",
	},
	{
		name: "a root with no cgroup to read gets a slice of its own",
		cgroup: "",
		expected: "pi-ow-k1",
	},
];

test.each(slices)("$name", ({ cgroup, expected }) => {
	expect(rootSliceOf(cgroup)("k1")).toBe(expected);
});

const shutDown = (reason: SessionShutdownEvent["reason"]) => {
	const stopAll = { called: false };

	const services = Layer.mergeAll(
		Layer.mock(Ledger)({ freeze: Effect.succeed(state) }),
		Layer.mock(PiCli)({ release: Effect.void }),
		Layer.mock(Slices)({
			wrap: (spec) => spec,
			stopAll: Effect.sync(() => {
				stopAll.called = true;
			}),
		}),
	);

	const shutdown: Effect.Effect<void, never, Ledger | PiCli | Slices> = leave({ agentKey: "old", stamp: 7 })({
		type: "session_shutdown",
		reason,
	});

	const shut = Effect.sync(() => ({ stoppedAll: stopAll.called, startsHanded: [take(), take()] }));

	return Effect.promise(() => piHost(services).run(Effect.andThen(shutdown, shut)));
};

test("a reload hands the ledger's state to the one session start after it, and stops no work", () =>
	Effect.runPromise(
		Effect.map(shutDown("reload"), (shut) => {
			expect(shut).toEqual({ stoppedAll: false, startsHanded: [handover, Option.none()] });
		}),
	));

test.each(["quit", "new", "resume", "fork"] as const)("a %s stops every slice and hands nothing over", (reason) =>
	Effect.runPromise(
		Effect.map(shutDown(reason), (shut) => {
			expect(shut).toEqual({ stoppedAll: true, startsHanded: [Option.none(), Option.none()] });
		}),
	),
);

type Argv = ReadonlyArray<ChildProcess.StandardCommand["args"][number]>;

const started = (inheritance: Inheritance) => {
	const commands: Array<Argv> = [];
	const warnings: Array<string> = [];

	const spawner = Layer.effect(
		ChildProcessSpawner.ChildProcessSpawner,
		Effect.map(ChildProcessSpawner.ChildProcessSpawner, (real) =>
			ChildProcessSpawner.make((command) =>
				Effect.suspend(() => {
					commands.push(ChildProcess.isStandardCommand(command) ? [command.command, ...command.args] : []);

					return real.spawn(ChildProcess.make("true"));
				}),
			),
		),
	);

	const ui = {
		notify: (message: string) => {
			warnings.push(message);
		},
	};

	const stop = stopStale({ ui, sliceOf: (agentKey) => `pi-ow-${agentKey}` })(inheritance);

	const stopped = Effect.sync(() => ({
		stopped: Arr.filter(Arr.filter(Arr.flatten(commands), Predicate.isString), Str.endsWith(".service")),
		warned: warnings.length,
	}));

	return Effect.promise(() =>
		piHost(Layer.provideMerge(spawner, NodeServices.layer)).run(Effect.andThen(stop, stopped)),
	);
};

interface StopRow {
	readonly name: string;
	readonly inheritance: Inheritance;
	readonly expected: { readonly stopped: Array<string>; readonly warned: number };
}

const stopRows: ReadonlyArray<StopRow> = [
	{
		name: "a reload that changed the ledger code stops the old work's slice and warns",
		inheritance: Inheritance.Stale({ agentKey: "new", stale: "old" }),
		expected: { stopped: ["pi-ow-old.service"], warned: 1 },
	},
	{
		name: "a reload that carries the work stops nothing",
		inheritance: Inheritance.Carried({ agentKey: "old", state }),
		expected: { stopped: [], warned: 0 },
	},
	{
		name: "a fresh start stops nothing",
		inheritance: Inheritance.Fresh({ agentKey: "new" }),
		expected: { stopped: [], warned: 0 },
	},
];

test.each(stopRows)("$name", ({ inheritance, expected }) =>
	Effect.runPromise(
		Effect.map(started(inheritance), (start) => {
			expect(start).toEqual(expected);
		}),
	),
);
