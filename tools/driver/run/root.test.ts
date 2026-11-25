import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";
import { type Layout, layoutOf, type World } from "#tools/driver/world/index.ts";
import { lfLines } from "./lines.ts";
import { type RootProcess, startRoot } from "./root.ts";

const rows = [
	{
		name: "U+2028 inside a record does not split it",
		carried: "",
		chunk: '{"text":"a\u2028b"}\n',
		expected: { lines: ['{"text":"a\u2028b"}'], rest: "" },
	},
	{
		name: "U+2029 inside a record does not split it",
		carried: "",
		chunk: '{"text":"a\u2029b"}\n{"n":2}\n',
		expected: { lines: ['{"text":"a\u2029b"}', '{"n":2}'], rest: "" },
	},
	{
		name: "a CR before the LF is dropped",
		carried: "",
		chunk: '{"n":1}\r\n{"n":2}\n',
		expected: { lines: ['{"n":1}', '{"n":2}'], rest: "" },
	},
	{
		name: "a record split across chunks waits for its LF",
		carried: "",
		chunk: '{"n":1}\n{"te',
		expected: { lines: ['{"n":1}'], rest: '{"te' },
	},
	{
		name: "the carried part joins the next chunk",
		carried: '{"te',
		chunk: 'xt":"x"}\n',
		expected: { lines: ['{"text":"x"}'], rest: "" },
	},
	{
		name: "a chunk with no LF yields no line",
		carried: '{"a"',
		chunk: ":1",
		expected: { lines: [], rest: '{"a":1' },
	},
];

test.each(rows)("lfLines: $name", ({ carried, chunk, expected }) => {
	expect(lfLines({ carried, chunk })).toEqual(expected);
});

const fakePi = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const print = (...records) => {
	const text = records.map((record) => JSON.stringify(record) + "\\n").join("");
	appendFileSync("stdout.jsonl", text);
	process.stdout.write(text);
};
let text;
for await (const line of console) {
	console.error(line);
	const command = JSON.parse(line);
	if (command.type === process.env.FAKE_IGNORES) continue;
	if (command.type === process.env.FAKE_EXITS_ON) process.exit(3);
	const data = {
		get_state: { sessionId: "s", sessionFile: "/s.jsonl" },
		prompt: { disposition: "queued" },
		get_last_assistant_text: { text: process.env.FAKE_NULL_TEXT === undefined ? text : null },
	}[command.type];
	const response = { type: "response", id: command.id, command: command.type, success: true, data };
	if (command.type !== "prompt") {
		print(response);
		continue;
	}
	const settled = () => {
		text = process.env.FAKE_TEXT;
		return { type: "agent_settled", aborted: process.env.FAKE_ABORTED !== undefined };
	};
	if (process.env.FAKE_SETTLES_AT_ONCE !== undefined) {
		print(response, settled());
		continue;
	}
	print(response, { type: "agent_start" });
	if (process.env.FAKE_NEVER_SETTLES !== undefined) continue;
	setTimeout(() => print(settled()), 200);
}
`;

const fakeWorld = (env: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tmp = yield* fs.makeTempDirectoryScoped();
		const layout = layoutOf({ tmp, name: "fake", stamp: "20260514-101010", pid: 42, tag: "0abc12" });

		yield* Effect.forEach([layout.bin, layout.project, layout.sessions], (dir) =>
			fs.makeDirectory(dir, { recursive: true }),
		);
		yield* fs.writeFileString(`${layout.bin}/pi`, fakePi, { mode: 0o755 });

		return {
			layout,
			agentDir: tmp,
			env: { PATH: Bun.env["PATH"] ?? "", ...env },
			pi: { version: "0.0.0", path: `${layout.bin}/pi` },
			exec: () => Effect.die("unused"),
		} satisfies World;
	});

const started = (world: World) => startRoot({ world, model: "a/b", progress: () => Effect.void });

const withRoot = <Value, Failure>(
	env: Readonly<Record<string, string>>,
	use: (root: RootProcess, layout: Layout) => Effect.Effect<Value, Failure, FileSystem.FileSystem>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const world = yield* fakeWorld(env);

			const root = yield* started(world);

			return yield* use(root, world.layout);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

test("startRoot returns the session pi reports to get_state", () =>
	withRoot({}, (root) =>
		Effect.sync(() => {
			expect(root.session).toEqual({ id: "s", file: "/s.jsonl" });
		}),
	));

test("prompt returns the text pi has once it settles, not before", () =>
	withRoot({ FAKE_TEXT: "ok" }, (root) =>
		Effect.gen(function* () {
			const reply = yield* root.prompt("hi");

			expect(reply).toEqual(Option.some("ok"));
		}),
	));

test("prompt settles when pi writes agent_settled in the same chunk as its response", () =>
	withRoot({ FAKE_TEXT: "ok", FAKE_SETTLES_AT_ONCE: "1" }, (root) =>
		Effect.gen(function* () {
			const reply = yield* root.prompt("hi", "5 seconds");

			expect(reply).toEqual(Option.some("ok"));
		}),
	));

test.each([
	{ name: "leaves text out", env: {} },
	{ name: "answers text null", env: { FAKE_NULL_TEXT: "1" } },
])("prompt returns none when pi has no assistant text and $name", ({ env }) =>
	withRoot(env, (root) =>
		Effect.gen(function* () {
			const reply = yield* root.prompt("hi");

			expect(reply).toEqual(Option.none());
		}),
	),
);

test("prompt returns none when pi settles aborted, even with an earlier assistant text", () =>
	withRoot({ FAKE_TEXT: "ok", FAKE_ABORTED: "1" }, (root) =>
		Effect.gen(function* () {
			const reply = yield* root.prompt("hi");

			expect(reply).toEqual(Option.none());
		}),
	));

test.each([
	{ name: "never answers prompt", env: { FAKE_IGNORES: "prompt" } },
	{ name: "answers but never settles", env: { FAKE_NEVER_SETTLES: "1" } },
	{ name: "never answers get_last_assistant_text", env: { FAKE_IGNORES: "get_last_assistant_text" } },
])("prompt fails within its deadline when pi $name", ({ env }) =>
	withRoot(env, (root) =>
		Effect.gen(function* () {
			const failure = yield* Effect.flip(root.prompt("hi", "300 millis"));

			expect(failure.message).toBe('the root did not settle within 0.3 s after "hi"');
		}),
	),
);

test("once the root pi exits, every call to it fails at once with its exit code", () =>
	withRoot({ FAKE_EXITS_ON: "prompt" }, (root, layout) =>
		Effect.gen(function* () {
			const failures = yield* Effect.forEach(
				[root.prompt("hi"), root.steer("hi"), root.compact, root.exited],
				Effect.flip,
			);

			expect(Arr.map(failures, (failure) => failure.message)).toEqual(
				Arr.replicate(`the root pi exited 3, see ${layout.rootStderr}`, 4),
			);
		}),
	));

test("pi reads each command the root sends, as root.in.jsonl logs it, each with its own id", () =>
	withRoot({}, (root, layout) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* root.prompt({ text: "hi", images: [] });
			yield* root.steer("go");
			yield* root.compact;

			const logged = yield* fs.readFileString(layout.rpcIn);

			yield* eventually(
				Effect.map(root.stderr, (read) => read === logged),
				"5 seconds",
			);
			expect(Str.split(logged, "\n")).toEqual([
				'{"id":"c1","type":"get_state"}',
				'{"id":"c2","type":"prompt","streamingBehavior":"followUp","message":"hi"}',
				'{"id":"c3","type":"get_last_assistant_text"}',
				'{"id":"c4","type":"steer","message":"go"}',
				'{"id":"c5","type":"compact"}',
				"",
			]);
		}),
	));

test("root.out.jsonl holds all of pi's stdout, the records the driver drops included", () =>
	withRoot({ FAKE_TEXT: "ok" }, (root, layout) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* root.prompt("hi");

			const logged = yield* fs.readFileString(layout.rpcOut);
			const written = yield* fs.readFileString(`${layout.project}/stdout.jsonl`);

			expect(logged).toContain('{"type":"agent_start"}');
			expect(logged).toBe(written);
		}),
	));
