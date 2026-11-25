import { afterAll, beforeAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { agentFileText, markdownIn } from "./index.ts";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/pi-agent-files-${String(process.pid)}`;

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

test("an agent file reads as it is now, after it was rewritten", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = `${scratch}/role.md`;

			yield* fs.writeFileString(file, "first");
			yield* agentFileText(file);
			yield* fs.writeFileString(file, "second");

			const text = yield* agentFileText(file);

			expect(text).toBe("second");
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("markdownIn lists the markdown files directly in a folder by name, and none in a missing one", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const dir = `${scratch}/guides`;

			yield* fs.makeDirectory(`${dir}/reference`, { recursive: true });
			yield* fs.writeFileString(`${dir}/tdd.md`, "");
			yield* fs.writeFileString(`${dir}/notes.txt`, "");
			yield* fs.writeFileString(`${dir}/reference/deep.md`, "");

			expect({
				listed: yield* markdownIn(dir),
				missing: yield* markdownIn(`${scratch}/absent`),
			}).toEqual({
				listed: [{ name: "tdd", path: `${dir}/tdd.md` }],
				missing: [],
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	));
