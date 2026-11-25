import { expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import type { Sessions } from "#tools/driver/index.ts";
import { watch } from "./observe.ts";

const holding = (request: string): Sessions => ({
	root: { id: "root", file: "root.jsonl", entries: [], loaded: Option.none(), requests: [request] },
	delegates: [],
});

const oneAtATime = <Value>(values: ReadonlyArray<Value>) => {
	let next = 0;

	return Effect.suspend(() => {
		const value = Arr.get(values, next);

		next += 1;

		return Effect.fromOption(value);
	});
};

test("once a look finds a build file edited, the run is judged on the sessions read before that edit", () => {
	const beforeEdit = holding("read the request");
	const afterEdit = holding("read the request, edited cyclefare/pricing.py, then read the architect skill");

	const watching = watch({
		start: holding("nothing yet"),
		sessions: oneAtATime([beforeEdit, afterEdit]),
		files: oneAtATime([["README.md"], ["README.md", "cyclefare/pricing.py"]]),
		stopAt: Str.startsWith("cyclefare/"),
	});

	return Effect.runPromise(
		Effect.map(watching, (watched) => {
			expect(watched).toEqual({ sessions: beforeEdit, editedFiles: ["README.md", "cyclefare/pricing.py"] });
		}),
	);
});
