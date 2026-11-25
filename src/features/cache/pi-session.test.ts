import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "./index.ts";

const pi = `${import.meta.dirname}/../../../node_modules/.bin/pi`;

const extension = `${import.meta.dirname}/../../../agent/extensions/cache/index.ts`;

const first = "cache-probe-first";

const second = "cache-probe-second";

const reply = (cacheWriteTokens: number) =>
	Arr.join(
		Arr.map(
			[
				'{"id":"c","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Done."}}]}',
				'{"id":"c","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
				`{"id":"c","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":100000,"completion_tokens":5,"total_tokens":100005,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":${String(cacheWriteTokens)}}}}`,
				"[DONE]",
			],
			(data) => `data: ${data}\n\n`,
		),
		"",
	);

const writesCache = reply(100_000);

const missesCache = reply(0);

const answered = (body: string) =>
	new Response(Str.includes(second)(body) ? missesCache : writesCache, {
		headers: { "content-type": "text/event-stream" },
	});

const provider = Effect.acquireRelease(
	Effect.sync(() =>
		Bun.serve({
			port: 0,
			fetch: (request) =>
				Effect.runPromise(
					Effect.map(
						Effect.promise(() => request.text()),
						answered,
					),
				),
		}),
	),
	(server) => Effect.promise(() => server.stop(true)),
);

const Entry = Schema.Struct({
	type: Schema.String,
	customType: Schema.optionalKey(Schema.String),
	message: Schema.optionalKey(Schema.Struct({ role: Schema.String })),
});

const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(Entry));

const kindOf = ({ type, customType, message }: typeof Entry.Type) => customType ?? message?.role ?? type;

const isReplyOrMiss = (kind: string) => kind === "assistant" || kind === entryKind;

const sessionKinds = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const server = yield* provider;
	const folder = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
	const sessions = `${folder}/sessions`;
	const baseUrl = `http://127.0.0.1:${String(server.port)}/v1`;

	yield* fs.writeFileString(
		`${folder}/models.json`,
		`{"providers":{"fake":{"baseUrl":"${baseUrl}","api":"openai-completions","apiKey":"none","models":[{"id":"m"}]}}}`,
	);

	const env = { ...Bun.env, PI_CODING_AGENT_DIR: folder };

	const prompt = (words: ReadonlyArray<string>) =>
		Effect.promise(
			() =>
				Bun.spawn([pi, "--session-dir", sessions, "--model", "fake/m", "-e", extension, "-p", ...words], {
					cwd: folder,
					env,
					stdout: "ignore",
					stderr: "ignore",
				}).exited,
		);

	yield* prompt(["--", first]);
	yield* prompt(["-c", "--", second]);

	const [file = ""] = yield* fs.readDirectory(sessions);
	const lines = yield* fs.readFileString(`${sessions}/${file}`);

	return yield* Effect.forEach(Arr.filter(Str.split(lines, "\n"), Str.isNonEmpty), (line) =>
		Effect.map(decodeEntry(line), kindOf),
	);
}).pipe(Effect.scoped);

test("in pi, a reply that misses the cache gets its entry right before it, and the first reply none", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const kinds = yield* sessionKinds;
			const replies = Arr.filter(kinds, isReplyOrMiss);

			expect(replies).toEqual(["assistant", entryKind, "assistant"]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));
