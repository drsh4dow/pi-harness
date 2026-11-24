import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";

const limitedFor = { "ultra-a": 20, "ultra-b": 60 } as const;

type Limited = keyof typeof limitedFor;

const isLimited = (account: string): account is Limited => account === "ultra-a" || account === "ultra-b";

interface Asked {
	readonly account: Limited;
	readonly at: number;
	readonly status: number;
}

const answer = Arr.join(
	[
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_mock","type":"message","role":"assistant","model":"claude-fable-5-2","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}',
		'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
		'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
		'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
		'event: message_stop\ndata: {"type":"message_stop"}',
		"",
	],
	"\n\n",
);

const weeklyLimitHit = (back: number) =>
	Response.json(
		{ type: "error", error: { type: "rate_limit_error", message: "This request would exceed your rate limit." } },
		{
			status: 429,
			headers: {
				"anthropic-ratelimit-unified-status": "rejected",
				"anthropic-ratelimit-unified-7d-status": "rejected",
				"anthropic-ratelimit-unified-7d-reset": String(Math.ceil(back / 1000)),
			},
		},
	);

const serveLimited = () => {
	const asked: Array<Asked> = [];
	const started: Array<number> = [];
	const backAt = (account: Limited) => (started[0] ?? 0) + limitedFor[account] * 1000;

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const account = Arr.get(Str.split(new URL(request.url).pathname, "/"), 1).pipe(Option.getOrElse(() => ""));
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe());

			if (!isLimited(account)) {
				return new Response("not found", { status: 404 });
			}

			if (started.length === 0) {
				started.push(now);
			}

			const limited = now < backAt(account);

			asked.push({ account, at: now, status: limited ? 429 : 200 });

			return limited
				? weeklyLimitHit(backAt(account))
				: new Response(answer, { headers: { "content-type": "text/event-stream" } });
		},
	});

	server.unref();

	return {
		baseUrl: (account: Limited) => `http://127.0.0.1:${String(server.port)}/${account}`,
		asked: () => Arr.copy(asked),
		backAt,
	};
};

const mock = serveLimited();

const movedTo = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.flatMap(entries, (entry) => (entry.type === "model_change" ? [entry.provider] : []));

const failedOver = (run: Run) =>
	Effect.gen(function* () {
		const asked = mock.asked();
		const back = mock.backAt("ultra-a");
		const answered = Arr.findLast(asked, ({ status }) => status === 200);
		const answeredAt = Option.match(answered, { onNone: () => "never", onSome: ({ at }) => String(at) });

		const moves = yield* run.waitFor("the root's model changes", "10 seconds", ({ root }) =>
			Option.some(movedTo(root.entries)),
		);

		yield* run.say(Arr.map(asked, ({ account, at, status }) => `${account} ${String(at)} ${String(status)}`));
		yield* run.check(
			Arr.join(moves, ",") === "ultra-a,ultra-b,ultra-a",
			`the root starts on ultra-a, moves to ultra-b once and back to ultra-a once (it moved to ${Arr.join(moves, ",")})`,
		);
		yield* run.check(
			Option.exists(answered, ({ account, at }) => account === "ultra-a" && at >= back),
			`ultra-a answers once its reset at ${String(back)} passed (it answered at ${answeredAt})`,
		);
	});

const showedTheWait = (run: Run) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const rpcOut = yield* fs.readFileString(path.join(path.dirname(run.home), "root.out.jsonl"));

		yield* run.check(
			Str.includes("is rate-limited. Waiting until")(rpcOut) && Str.includes("rate-limited until")(rpcOut),
			"the root shows the human it waits, in a notice and in its status line",
		);
	});

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	models: { "ultra-a": { baseUrl: mock.baseUrl("ultra-a") }, "ultra-b": { baseUrl: mock.baseUrl("ultra-b") } },
	play: (run) =>
		Effect.gen(function* () {
			const reply = yield* run.root.prompt("Reply with the single word ok.", "3 minutes");

			yield* run.check(
				Option.contains(reply, "ok"),
				`the root answers ok (it answered ${Option.getOrElse(reply, () => "nothing")})`,
			);
			yield* failedOver(run);
			yield* showedTheWait(run);
		}),
});
