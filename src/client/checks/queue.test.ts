import { afterAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Str from "effect/String";

import { holdPlace } from "./queue.ts";

const folder = `${Bun.env["TMPDIR"] ?? "/tmp"}/queue-client-test-${String(process.pid)}`;

const run = <Value, Failure>(body: Effect.Effect<Value, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(body, NodeServices.layer));

afterAll(() => run(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(folder, { recursive: true }))));

const lateTickets = (fs: FileSystem.FileSystem, latch: Latch.Latch): FileSystem.FileSystem => ({
	...fs,
	writeFileString: (path, data, options) => {
		const write = fs.writeFileString(path, data, options);

		return Str.endsWith(".json")(path) ? Effect.andThen(latch.await, write) : write;
	},
});

const holder = (counts: { holding: number; most: number }, settled: Latch.Latch, leave: Latch.Latch) =>
	Effect.scoped(
		Effect.gen(function* () {
			const late = `${folder}/late`;

			yield* holdPlace({
				folder: late,
				places: 1,
				holder: { command: "check", cwd: late },
				onWait: () => settled.open,
			});
			counts.holding += 1;
			counts.most = Math.max(counts.most, counts.holding);
			yield* settled.open;
			yield* leave.await;
			counts.holding -= 1;
		}),
	);

test(
	"a caller whose ticket shows up late does not take the place from one already holding it",
	() =>
		run(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const [firstSettled, secondSettled] = [yield* Latch.make(), yield* Latch.make()];
				const counts = { holding: 0, most: 0 };

				const first = Effect.provideService(
					holder(counts, firstSettled, Latch.makeUnsafe(true)),
					FileSystem.FileSystem,
					lateTickets(fs, secondSettled),
				);

				const second = holder(counts, secondSettled, firstSettled);

				yield* Effect.all([first, second], { concurrency: 2 });

				expect(counts.most).toBe(1);
			}),
		),
	{ timeout: 60_000 },
);

const otherHolder = '{"pid":1,"command":"other","cwd":"/"}';

const laneWith = (name: string, others: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const lane = `${folder}/${name}`;

		yield* fs.makeDirectory(lane, { recursive: true });
		yield* Effect.forEach(others, (file) => fs.writeFileString(`${lane}/${file}`, otherHolder));

		return lane;
	});

const holds = (lane: string, places: number) =>
	holdPlace({ folder: lane, places, holder: { command: "check", cwd: lane }, onWait: () => Effect.void });

const placeOrWait = (lane: string, places: number) =>
	Effect.gen(function* () {
		const waited = yield* Latch.make();

		const place = Effect.scoped(
			holdPlace({ folder: lane, places, holder: { command: "check", cwd: lane }, onWait: () => waited.open }),
		);

		return yield* Effect.raceFirst(Effect.as(place, "held"), Effect.as(waited.await, "waited"));
	});

test("a ticket numbered 10 lines up behind one numbered 9", () =>
	run(
		Effect.gen(function* () {
			const lane = yield* laneWith("tenth", ["000000000000008-1-0.json"]);

			const tenth = yield* Effect.scoped(Effect.andThen(holds(lane, 2), placeOrWait(lane, 2)));

			expect(tenth).toBe("waited");
		}),
	));

test("a caller first in line waits while another is still taking a number", () =>
	run(
		Effect.gen(function* () {
			const lane = yield* laneWith("choosing", ["choosing-1-0"]);

			const first = yield* placeOrWait(lane, 1);

			expect(first).toBe("waited");
		}),
	));

const finishesOnFirstLook = (fs: FileSystem.FileSystem, lane: string): FileSystem.FileSystem => {
	let finished = false;

	const finish = Effect.andThen(
		fs.writeFileString(`${lane}/000000000000001-1-0.json`, otherHolder),
		fs.remove(`${lane}/choosing-1-0`),
	);

	return {
		...fs,
		readDirectory: (path, options) =>
			Effect.tap(fs.readDirectory(path, options), (names) => {
				if (finished || !Arr.some(names, Str.endsWith(".json"))) {
					return Effect.void;
				}

				finished = true;

				return finish;
			}),
	};
};

test("a number taken while a caller looks at the line counts ahead of it", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const lane = yield* laneWith("looking", ["choosing-1-0"]);

			const first = yield* Effect.provideService(
				placeOrWait(lane, 1),
				FileSystem.FileSystem,
				finishesOnFirstLook(fs, lane),
			);

			expect(first).toBe("waited");
		}),
	));
