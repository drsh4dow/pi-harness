import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { scratchFolder } from "#src/primitives/scratch.fixture.ts";
import { BriefSources, briefSourcesLayer } from "./index.ts";

const briefSources = Layer.provideMerge(briefSourcesLayer, NodeServices.layer);

const scratch = scratchFolder("brief-sources");

test("readIfPresent gives None for a missing file and the text of one that exists", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const sources = yield* BriefSources;
			const file = `${scratch}/AGENTS.md`;

			yield* fs.writeFileString(file, "Review.");

			expect({
				present: yield* sources.readIfPresent(file),
				missing: yield* sources.readIfPresent(`${scratch}/absent.md`),
			}).toEqual({ present: Option.some("Review."), missing: Option.none() });
		}).pipe(Effect.provide(briefSources)),
	));

test("repoRoot is the nearest folder at or above that holds a .git, and None above the last one", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const sources = yield* BriefSources;
			const outer = `${scratch}/outer`;
			const inner = `${outer}/inner`;

			yield* fs.makeDirectory(`${outer}/.git`, { recursive: true });
			yield* fs.makeDirectory(`${inner}/deep`, { recursive: true });
			yield* fs.writeFileString(`${inner}/.git`, "gitdir: elsewhere");

			expect({
				deep: yield* sources.repoRoot(`${inner}/deep`),
				inner: yield* sources.repoRoot(inner),
				outer: yield* sources.repoRoot(outer),
				top: yield* sources.repoRoot("/"),
			}).toEqual({
				deep: Option.some(inner),
				inner: Option.some(inner),
				outer: Option.some(outer),
				top: Option.none(),
			});
		}).pipe(Effect.provide(briefSources)),
	));

test("realFolder resolves a link to a folder, and refuses a file or a missing path", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const sources = yield* BriefSources;
			const folder = `${scratch}/real`;
			const file = `${scratch}/plain.md`;

			yield* fs.makeDirectory(folder, { recursive: true });
			yield* fs.symlink(folder, `${scratch}/link`);
			yield* fs.writeFileString(file, "");

			const refusal = (path: string) => Effect.map(Effect.flip(sources.realFolder(path)), ({ why }) => why);

			expect({
				linked: yield* sources.realFolder(`${scratch}/link`),
				file: yield* refusal(file),
				missing: yield* refusal(`${scratch}/absent`),
			}).toEqual({ linked: yield* fs.realPath(folder), file: "not a folder", missing: "NotFound" });
		}).pipe(Effect.provide(briefSources)),
	));
