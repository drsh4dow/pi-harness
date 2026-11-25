import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { reporter } from "./report.ts";

const world = Layer.merge(NodeServices.layer, TestClock.layer());

test("say appends a string as is and other JSON as one line to the report", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = yield* fs.makeTempDirectoryScoped();
			const report = yield* reporter(`${folder}/report.txt`);

			yield* report.say("plain text");
			yield* report.say({ list: [1, "two"] });

			const written = yield* fs.readFileString(`${folder}/report.txt`);

			expect(written).toBe('plain text\n{"list":[1,"two"]}\n');
		}).pipe(Effect.scoped, Effect.provide(world)),
	));

test("elapsed and progress count whole seconds since the reporter started", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = yield* fs.makeTempDirectoryScoped();
			const report = yield* reporter(`${folder}/report.txt`);

			yield* TestClock.adjust("2600 millis");
			yield* report.progress("found it");

			const elapsed = yield* report.elapsed;
			const written = yield* fs.readFileString(`${folder}/report.txt`);

			expect([elapsed, written]).toEqual([3, "  3 s  found it\n"]);
		}).pipe(Effect.scoped, Effect.provide(world)),
	));
