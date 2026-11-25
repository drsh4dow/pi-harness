import { expect, test } from "bun:test";

import { VERSION } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { Probed, textOf } from "./probe.ts";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

const rows = [
	{ name: "a string is its own text", payload: '"hello"', expected: "hello" },
	{
		name: "strings join in traversal order, one per line",
		payload: '{"system":[{"type":"text","text":"rules"}],"messages":[{"role":"user","content":"hi"}]}',
		expected: "text\nrules\nuser\nhi",
	},
	{
		name: "numbers, booleans and null are left out",
		payload: '{"max_tokens":10,"stream":true,"stop":null,"model":"m"}',
		expected: "m",
	},
	{ name: "an empty payload has no text", payload: "{}", expected: "" },
] as const;

test.each(rows)("textOf: $name", ({ payload, expected }) =>
	Effect.runPromise(
		Effect.map(decodeJson(payload), (json) => {
			expect(textOf(json)).toBe(expected);
		}),
	),
);

interface Step {
	readonly event: "session_start" | "agent_start" | "before_provider_request";
	readonly tools?: ReadonlyArray<string>;
	readonly commands?: ReadonlyArray<{ readonly source: "extension" | "prompt" | "skill"; readonly path: string }>;
	readonly settings?: Schema.JsonObject;
	readonly payload?: Schema.Json;
}

const fakePi = `
import probeExtension from "${import.meta.dirname}/probe.ts";
const handlers = new Map();
let step;
probeExtension({
	on: (event, handler) => handlers.set(event, handler),
	getAllTools: () => (step.tools ?? []).map((path) => ({ sourceInfo: { path } })),
	getCommands: () => (step.commands ?? []).map(({ source, path }) => ({ source, sourceInfo: { path } })),
	getSettings: () => step.settings ?? {},
});
const ctx = {
	model: { provider: "p", id: "m", contextWindow: 40000 },
	sessionManager: { getSessionId: () => "s" },
	modelRegistry: { getError: () => undefined },
};
const returned = [];
for (step of JSON.parse(process.argv[1])) {
	returned.push(typeof (await handlers.get(step.event)?.({ payload: step.payload }, ctx)));
}
console.log(JSON.stringify(returned));
`;

const encodeSteps = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodeReturned = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)));

const decodeProbed = Schema.decodeUnknownEffect(Schema.fromJsonString(Probed));

const runPi = ({
	steps,
	cwd,
	env,
}: {
	readonly steps: ReadonlyArray<Step>;
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
}) =>
	Effect.gen(function* () {
		const argv = yield* encodeSteps(steps);

		const pi = Bun.spawn([process.execPath, "-e", fakePi, argv], {
			env: { HOME: Bun.env["HOME"] ?? "", ...env },
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, code] = yield* Effect.promise(() =>
			Promise.all([new Response(pi.stdout).text(), new Response(pi.stderr).text(), pi.exited]),
		);

		if (code !== 0) {
			return yield* Effect.die(stderr);
		}

		const returned = yield* decodeReturned(stdout);

		return { pid: pi.pid, returned };
	});

const socket = "/run/core.sock";

const probe = ({ home, steps }: { readonly home: string; readonly steps: ReadonlyArray<Step> }) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const folder = `${home}/probe`;

		yield* fs.makeDirectory(folder);

		const { pid, returned } = yield* runPi({
			steps,
			cwd: home,
			env: { PI_DRIVER_PROBE: folder, HC_TERMINAL_SOCKET: socket },
		});

		const files = yield* fs.readDirectory(folder);
		const text = yield* fs.readFileString(`${folder}/${String(pid)}.jsonl`);

		const records = yield* Effect.forEach(Arr.filter(Str.split(text, "\n"), Str.isNonEmpty), (line) =>
			decodeProbed(line),
		);

		return { pid, files, returned, records };
	});

const extensionsOf = (records: ReadonlyArray<Probed>) =>
	Arr.flatMap(records, (record) => (record.type === "loaded" ? [record.extensions] : []));

const requestsOf = (records: ReadonlyArray<Probed>) =>
	Arr.flatMap(records, (record) => (record.type === "request" ? [record.text] : []));

const inHome = <Value, Failure>(use: (home: string) => Effect.Effect<Value, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
			const home = yield* fs.realPath(tmp);

			return yield* use(home);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

const touch = (files: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		yield* Effect.forEach(files, (file) => fs.writeFileString(file, ""));
	});

const everyEvent: ReadonlyArray<Step> = [
	{ event: "session_start" },
	{ event: "agent_start" },
	{ event: "before_provider_request", payload: { messages: [{ role: "user", content: "hi" }] } },
];

test("with PI_DRIVER_PROBE unset the probe writes nothing", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;

			yield* runPi({ steps: everyEvent, cwd: home, env: {} });

			const written = yield* fs.readDirectory(home, { recursive: true });

			expect(written).toEqual([]);
		}),
	));

test("each session start, agent start and provider request appends one record to <pid>.jsonl", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const { pid, files, records } = yield* probe({ home, steps: everyEvent });

			expect({
				files,
				kinds: Arr.map(records, (record) => record.type),
				requests: requestsOf(records),
			}).toEqual({
				files: [`${String(pid)}.jsonl`],
				kinds: ["loaded", "loaded", "request"],
				requests: ["user\nhi"],
			});
		}),
	));

test("no handler returns a value to pi", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const { returned } = yield* probe({ home, steps: everyEvent });

			expect(returned).toEqual(["undefined", "undefined", "undefined"]);
		}),
	));

test("a session start records the model, its context window, pi's settings and the core socket", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const settings = { compaction: { enabled: true }, theme: "dark" };
			const { records } = yield* probe({ home, steps: [{ event: "session_start", settings }] });

			expect(records).toEqual([
				{
					type: "loaded",
					session: "s",
					version: VERSION,
					model: "p/m",
					contextWindow: 40_000,
					extensions: [],
					settings,
					modelsError: Option.none(),
					socket: Option.some(socket),
				},
			]);
		}),
	));

test("extensions lists each file that registered a tool or a command once, links resolved, sorted", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const [first, second, command] = [`${home}/a.ts`, `${home}/b.ts`, `${home}/c.ts`];

			yield* touch([first, second, command]);
			yield* fs.symlink(first, `${home}/link.ts`);

			const { records } = yield* probe({
				home,
				steps: [
					{
						event: "session_start",
						tools: [second, `${home}/link.ts`, first, first],
						commands: [{ source: "extension", path: command }],
					},
				],
			});

			expect(extensionsOf(records)).toEqual([[first, second, command]]);
		}),
	));

test("extensions leaves out built-in tools and skill and prompt commands", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const [tool, skill, prompt] = [`${home}/tool.ts`, `${home}/SKILL.md`, `${home}/prompt.md`];

			yield* touch([tool, skill, prompt]);

			const { records } = yield* probe({
				home,
				steps: [
					{
						event: "session_start",
						tools: ["builtin:read", tool],
						commands: [
							{ source: "skill", path: skill },
							{ source: "prompt", path: prompt },
						],
					},
				],
			});

			expect(extensionsOf(records)).toEqual([[tool]]);
		}),
	));

test("a tool an extension registers in its own session_start handler shows from the first agent start", () =>
	inHome((home) =>
		Effect.gen(function* () {
			const tool = `${home}/tool.ts`;

			yield* touch([tool]);

			const { records } = yield* probe({
				home,
				steps: [{ event: "session_start" }, { event: "agent_start", tools: [tool] }],
			});

			expect(extensionsOf(records)).toEqual([[], [tool]]);
		}),
	));
