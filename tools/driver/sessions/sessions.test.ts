import { expect, test } from "bun:test";

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Rec from "effect/Record";
import type * as Scope from "effect/Scope";

import { readSessions } from "./sessions.ts";

const headerOf = (id: string) =>
	`{"type":"session","version":3,"id":"${id}","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/w"}`;

const entry: SessionEntry = {
	type: "message",
	id: "e1",
	parentId: "e0",
	timestamp: "2026-01-01T00:00:01.000Z",
	message: { role: "user", content: "hi", timestamp: 1 },
};

const entryLine =
	'{"type":"message","id":"e1","parentId":"e0","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"hi","timestamp":1}}';

const loadedLine = ({ session, model }: { readonly session: string; readonly model: string }) =>
	`{"type":"loaded","session":"${session}","version":"1.5.2","model":"${model}","contextWindow":40000,"extensions":[],"settings":{}}`;

const requestLine = ({ session, text }: { readonly session: string; readonly text: string }) =>
	`{"type":"request","session":"${session}","text":"${text}"}`;

const read = (files: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const tmp = yield* fs.makeTempDirectoryScoped();

		yield* Effect.forEach(Rec.toEntries(files), ([name, text]) =>
			Effect.andThen(fs.makeDirectory(path.dirname(`${tmp}/${name}`), { recursive: true }), () =>
				fs.writeFileString(`${tmp}/${name}`, text),
			),
		);

		const sessions = yield* readSessions({
			root: { id: "root", file: `${tmp}/sessions/root.jsonl` },
			sessionDir: `${tmp}/sessions`,
			probeDir: `${tmp}/probe`,
		});

		return { tmp, sessions };
	});

const run = <Failure>(effect: Effect.Effect<void, Failure, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
	Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

test("a root with no file yet has its id, its file and no entries", () =>
	run(
		Effect.map(read({}), ({ tmp, sessions }) => {
			expect(sessions).toEqual({
				root: { id: "root", file: `${tmp}/sessions/root.jsonl`, entries: [], loaded: Option.none(), requests: [] },
				delegates: [],
			});
		}),
	));

const unendedEntry = { "sessions/root.jsonl": `${headerOf("root")}\n${entryLine}\n${entryLine}` };

test("entries leave out the header and a last line pi has not ended with an LF", () =>
	run(
		Effect.map(read(unendedEntry), ({ sessions }) => {
			expect(sessions.root.entries).toEqual([entry]);
		}),
	));

const unendedHeader = { "sessions/delegates/d.jsonl": headerOf("d") };

test("a delegate file whose header has no LF yet is no session", () =>
	run(
		Effect.map(read(unendedHeader), ({ sessions }) => {
			expect(sessions.delegates).toEqual([]);
		}),
	));

const nested = {
	"sessions/delegates/2026-01-02_b.jsonl": `${headerOf("b")}\n`,
	"sessions/delegates/b/delegates/2026-01-01_a.jsonl": `${headerOf("a")}\n`,
	"sessions/delegates/2026-01-03_c.jsonl": `${headerOf("c")}\n`,
};

test("delegates come from every depth under delegates/, ordered by file name", () =>
	run(
		Effect.map(read(nested), ({ sessions }) => {
			expect(Arr.map(sessions.delegates, (session) => session.id)).toEqual(["a", "b", "c"]);
		}),
	));

const twiceLoaded = {
	"sessions/root.jsonl": `${headerOf("root")}\n`,
	"sessions/delegates/d.jsonl": `${headerOf("d")}\n`,
	"probe/1.jsonl": Arr.join(
		[
			loadedLine({ session: "root", model: "p/early" }),
			loadedLine({ session: "other", model: "p/other" }),
			loadedLine({ session: "root", model: "p/later" }),
			"",
		],
		"\n",
	),
};

test("loaded is the session's latest loaded record, and None before its first", () =>
	run(
		Effect.map(read(twiceLoaded), ({ sessions }) => {
			expect({
				root: Option.map(sessions.root.loaded, (loaded) => loaded.model),
				delegates: Arr.map(sessions.delegates, (session) => session.loaded),
			}).toEqual({ root: Option.some("p/later"), delegates: [Option.none()] });
		}),
	));

const interleaved = {
	"probe/1.jsonl": Arr.join(
		[
			requestLine({ session: "root", text: "first" }),
			requestLine({ session: "other", text: "theirs" }),
			requestLine({ session: "root", text: "second" }),
			"",
		],
		"\n",
	),
};

test("requests hold the text of the session's own requests, oldest first", () =>
	run(
		Effect.map(read(interleaved), ({ sessions }) => {
			expect(sessions.root.requests).toEqual(["first", "second"]);
		}),
	));

const unendedRequest = {
	"probe/1.jsonl": Arr.join(
		[
			"not a record",
			requestLine({ session: "root", text: "first" }),
			requestLine({ session: "root", text: "unended" }),
		],
		"\n",
	),
};

test("a probe line that is not a record, or that has no LF yet, is skipped", () =>
	run(
		Effect.map(read(unendedRequest), ({ sessions }) => {
			expect(sessions.root.requests).toEqual(["first"]);
		}),
	));
