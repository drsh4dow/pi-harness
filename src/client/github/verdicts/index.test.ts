import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { recordVerdict, type VerdictRecord, verdictsOf } from "./index.ts";

const recordAt = (head: string): VerdictRecord => ({
	repo: "o/r",
	number: 7,
	head,
	patchId: "p",
	result: "pass",
	verifier: { name: "verifier", session: "s", model: "m" },
	answer: "VERDICT: PASS",
});

test("verdictsOf leaves out a file that is not a record and returns the rest by file name", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped();

			yield* recordVerdict(root)(recordAt("b"));
			yield* recordVerdict(root)(recordAt("a"));
			yield* fs.writeFileString(`${root}/o/r/7/a.broken.json`, "{}");

			const records = yield* verdictsOf(root)({ repo: "o/r", number: 7 });

			expect(records).toEqual([recordAt("a"), recordAt("b")]);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	));
