import { afterAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
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
			yield* holdPlace({ folder, places: 1, holder: { command: "check", cwd: folder }, onWait: () => settled.open });
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
