import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { scratchFolder } from "#src/primitives/scratch.fixture.ts";
import { SourceStamp, sourceStampLayer } from "./index.ts";

const stamps = Layer.provideMerge(sourceStampLayer, NodeServices.layer);

const scratch = scratchFolder("source-stamp");

const stampOf = (files: ReadonlyArray<string>) => Effect.flatMap(SourceStamp, (stamp) => stamp.of(files));

test("a stamp changes with the files' text, and an unreadable file gives a stamp no other call shares", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = `${scratch}/ledger.ts`;
			const missing = [file, `${scratch}/absent.ts`];

			yield* fs.writeFileString(file, "one");

			const first = yield* stampOf([file]);
			const again = yield* stampOf([file]);

			yield* fs.writeFileString(file, "two");

			const changed = yield* stampOf([file]);
			const unreadable = yield* stampOf(missing);
			const unreadableAgain = yield* stampOf(missing);

			expect({
				again: again === first,
				changed: changed === first,
				unreadable: unreadable === unreadableAgain,
			}).toEqual({ again: true, changed: false, unreadable: false });
		}).pipe(Effect.provide(stamps)),
	));
