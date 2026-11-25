import { afterAll, beforeAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { appendedLines } from "./index.ts";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/pi-sessions-follow-${String(process.pid)}`;

beforeAll(() =>
	Effect.runPromise(
		Effect.flatMap(FileSystem.FileSystem, (fs) =>
			Effect.andThen(
				fs.remove(scratch, { recursive: true, force: true }),
				fs.makeDirectory(scratch, { recursive: true }),
			),
		).pipe(Effect.provide(NodeServices.layer)),
	),
);

afterAll(() =>
	Effect.runPromise(
		Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(scratch, { recursive: true })).pipe(
			Effect.provide(NodeServices.layer),
		),
	),
);

test("appended lines stop at the last newline, and a file shorter than what was read is read again from the start", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = `${scratch}/session.jsonl`;

			yield* fs.writeFileString(path, "a\nb\nhalf");

			const first = yield* appendedLines({ path, offset: 0 });

			yield* fs.writeFileString(path, "a\nb\nhalf done\n");

			const second = yield* appendedLines({ path, offset: 4 });

			yield* fs.writeFileString(path, "x\n");

			const replaced = yield* appendedLines({ path, offset: 14 });
			const missing = yield* appendedLines({ path: `${scratch}/absent.jsonl`, offset: 0 });

			expect({ first, second, replaced, missing }).toEqual({
				first: Option.some({ replaced: false, text: "a\nb\n", offset: 4 }),
				second: Option.some({ replaced: false, text: "half done\n", offset: 14 }),
				replaced: Option.some({ replaced: true, text: "x\n", offset: 2 }),
				missing: Option.none(),
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	));
