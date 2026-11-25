import { expect } from "bun:test";

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";

import { Act } from "#src/features/owned-work/ledger/act.fixture.ts";
import { Out } from "#src/features/owned-work/ledger/out/index.ts";
import { showAll, type World } from "#src/features/owned-work/ledger/world.fixture.ts";
import { WorkRef } from "#src/features/owned-work/work.ts";
import type { Waited } from "./index.ts";

const noneIfEmpty = (shown: string) => (shown === "" ? "none" : shown);

const showWaited = ({ results, running }: Waited): string =>
	`${noneIfEmpty(showAll(results))} | running ${noneIfEmpty(Arr.join(running, ", "))}`;

export const waitStarts = (refs?: ReadonlyArray<string>) =>
	Act.Drive({
		run: (world) =>
			Effect.gen(function* () {
				const stop = yield* Latch.make();
				const scope = Option.map(Option.fromUndefinedOr(refs), Arr.map(WorkRef));

				const reply = world.ledger.wait(scope, stop.await).pipe(
					Effect.tap(({ results }) => Effect.sync(() => world.delivered.push(...results))),
					Effect.match({ onFailure: (error) => Out.error(error).message, onSuccess: showWaited }),
				);

				world.waits.push({ reply: yield* Effect.forkIn(reply, world.scope), stop });
			}),
	});

const firstWait = (world: World) => Effect.orDie(Effect.fromNullishOr(world.waits[0]));

export const waitStops = Act.Drive({ run: (world) => Effect.flatMap(firstWait(world), ({ stop }) => stop.open) });

export const waitsBlocking = (expected: number) =>
	Act.Drive({
		run: (world) =>
			Effect.sync(() => {
				expect(Arr.filter(world.waits, ({ reply }) => reply.pollUnsafe() === undefined).length).toBe(expected);
			}),
	});

/** Takes the first wait's reply, and checks it unless the row cannot know which delivery got the result. */
export const waitReturns = (expected?: string) =>
	Act.Drive({
		run: (world) =>
			Effect.gen(function* () {
				const { reply } = yield* firstWait(world);
				const got = yield* Fiber.join(reply);

				world.waits.shift();

				if (expected !== undefined) {
					expect(got).toBe(expected);
				}
			}),
	});

export const together = (...acts: ReadonlyArray<Act>) =>
	Act.Drive({ run: (_world, perform) => Effect.asVoid(Effect.forEach(acts, perform, { concurrency: "unbounded" })) });
