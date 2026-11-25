import { afterAll, expect, test } from "bun:test";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Act, type Row, runRow } from "#src/features/owned-work/ledger/ledger.fixture.ts";
import { exit, sessionRoot } from "#src/features/owned-work/ledger/world.fixture.ts";
import { messageOf } from "#src/features/owned-work/session/index.ts";
import { Outcome, WorkRef } from "#src/features/owned-work/work.ts";
import { Waiting } from "./index.ts";
import { together, waitReturns, waitStarts, waitStops, waitsBlocking } from "./wait.fixture.ts";

const { Hook, Start, Answer, End, TurnEnds } = Act;

const runs = Hook({ event: "run starts" });

const fired = (ref: string) => `${ref} fired 0 (log watch.log): tail`;

const rows: ReadonlyArray<Row> = [
	{
		name: "a wait returns at once with a result that settled before it, and the turn's end does not deliver it again",
		role: "owner",
		acts: [
			runs,
			Start({ kind: "watch" }),
			End({ terminal: "t1", end: exit(0) }),
			waitStarts(),
			waitReturns(`${fired("watch-1")} | running none`),
			TurnEnds({ expect: "finish: " }),
		],
	},
	{
		name: "a wait returns at once when the agent holds nothing that runs",
		role: "owner",
		acts: [runs, Start({ kind: "serve" }), waitStarts(), waitReturns("none | running none")],
	},
	{
		name: "a wait blocks until a job it holds settles, then returns that result and names the job still running",
		role: "root",
		acts: [
			runs,
			Start({ kind: "watch" }),
			Start({ kind: "delegate" }),
			waitStarts(),
			waitsBlocking(1),
			Answer({ terminal: "t2", text: "built", end: exit(0) }),
			waitReturns("delegate-2 done: built | running watch-1"),
			End({ terminal: "t1", end: exit(0) }),
			TurnEnds({ expect: `continue: ${fired("watch-1")}` }),
		],
	},
	{
		name: "a wait for named jobs ignores another job's settle, then returns every result due",
		role: "owner",
		acts: [
			runs,
			Start({ kind: "watch" }),
			Start({ kind: "watch", name: "lint" }),
			waitStarts(["watch-2"]),
			End({ terminal: "t1", end: exit(0) }),
			waitsBlocking(1),
			End({ terminal: "t2", end: exit(0) }),
			waitReturns(`${fired("watch-1")}; ${fired("watch-2")} | running none`),
			TurnEnds({ expect: "finish: " }),
		],
	},
	{
		name: "a stopped wait names the jobs still running, and a result that settles after it wakes the agent at the turn's end",
		role: "owner",
		acts: [
			runs,
			Start({ kind: "watch" }),
			waitStarts(),
			waitStops,
			waitReturns("none | running watch-1"),
			End({ terminal: "t1", end: exit(0) }),
			TurnEnds({ expect: `continue: ${fired("watch-1")}` }),
		],
	},
	{
		name: "a wait for a job the agent does not hold is refused",
		role: "owner",
		acts: [
			runs,
			Start({ kind: "delegate", group: "review" }),
			waitStarts(["delegate-9"]),
			waitReturns("no work is called delegate-9"),
			waitStarts(["delegate-1"]),
			waitReturns("delegate-1: group-2 holds it"),
			Answer({ terminal: "t1", text: "built", end: exit(0) }),
			TurnEnds({ expect: "continue: group-2 [delegate-1 done: built]" }),
		],
	},
	{
		name: "a job that settles as its wait returns reaches the agent exactly once, in the wait's reply or in a wake",
		role: "owner",
		acts: [
			runs,
			Start({ kind: "watch" }),
			waitStarts(),
			together(waitStops, End({ terminal: "t1", end: exit(0) })),
			waitReturns(),
			Hook({ event: "goes idle" }),
		],
	},
];

test.each(rows)("$name", (row) => Effect.runPromise(runRow(row)));

test("each result in a wait's reply reads exactly as its wake does", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const settled = {
				ref: WorkRef("watch-1"),
				who: { kind: "watch" as const, name: "nap", command: "sleep 15" },
				outcome: Outcome.Fired({ exitCode: 0, tail: "napped" }),
				log: Option.some("nap.log"),
			};

			const wake = yield* messageOf(settled);
			const reply = yield* Waiting.reply({ results: [settled], running: [] }, false);

			expect(reply.content).toEqual([{ type: "text", text: wake.content }]);
		}),
	));

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${sessionRoot}`.quiet())));
