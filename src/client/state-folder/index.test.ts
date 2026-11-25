import { afterAll, beforeAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { StateFolder, stateFolderLayer } from "./index.ts";

const stateFolders = Layer.provideMerge(stateFolderLayer, NodeServices.layer);

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/state-folder-${String(process.pid)}`;

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

const fingerprint = (folder: string) => Effect.flatMap(StateFolder, (state) => state.fingerprint(folder));

const changedNames = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>) =>
	Arr.filter([...after.keys()], (name) => after.get(name) !== before.get(name));

test("a fingerprint differs only at the entries whose size or mtime changed", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = `${scratch}/work`;
			const then = DateTime.toDate(DateTime.makeUnsafe("2026-11-01T00:00:00Z"));
			const later = DateTime.toDate(DateTime.makeUnsafe("2026-11-02T00:00:00Z"));

			yield* fs.makeDirectory(folder, { recursive: true });
			yield* fs.writeFileString(`${folder}/todo.md`, "one");
			yield* fs.writeFileString(`${folder}/trail.md`, "one");
			yield* fs.utimes(`${folder}/todo.md`, then, then);
			yield* fs.utimes(`${folder}/trail.md`, then, then);

			const before = yield* fingerprint(folder);
			const unchanged = yield* fingerprint(folder);

			yield* fs.writeFileString(`${folder}/todo.md`, "three");
			yield* fs.utimes(`${folder}/todo.md`, then, then);

			const resized = yield* fingerprint(folder);

			yield* fs.utimes(`${folder}/trail.md`, later, later);

			const touched = yield* fingerprint(folder);

			expect({
				unchanged: changedNames(before, unchanged),
				resized: changedNames(unchanged, resized),
				touched: changedNames(resized, touched),
			}).toEqual({ unchanged: [], resized: ["todo.md"], touched: ["trail.md"] });
		}).pipe(Effect.provide(stateFolders)),
	));

test("a folder that cannot be listed has an empty fingerprint, and an entry that cannot be read an empty stamp", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = `${scratch}/dangling`;

			yield* fs.makeDirectory(folder, { recursive: true });
			yield* fs.symlink(`${scratch}/absent`, `${folder}/link`);

			expect({
				missing: yield* fingerprint(`${scratch}/absent`),
				dangling: yield* fingerprint(folder),
			}).toEqual({ missing: new Map(), dangling: new Map([["link", ""]]) });
		}).pipe(Effect.provide(stateFolders)),
	));
