import { DEFAULT_MAX_BYTES, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { Cause, cacheTtlMs, entryKind, Miss } from "./index.ts";

const Recorded = Schema.Struct({ type: Schema.Literal("custom"), customType: Schema.Literal(entryKind), data: Miss });

const decodeRecorded = Schema.decodeUnknownOption(Recorded);

const missIn = (entries: ReadonlyArray<SessionEntry>) => Arr.findFirst(entries, (entry) => decodeRecorded(entry));

const isCacheWarm = (entry: SessionEntry) => entry.type === "usage" && entry.kind === "cache_warm";

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) =>
		Effect.gen(function* () {
			const filler = yield* run.exec([
				"sh",
				"-c",
				"head -c 34000 /dev/urandom | base64 -w 76 > filler-1.txt && head -c 12000 /dev/urandom | base64 -w 76 > filler-2.txt",
			]);

			yield* run.check(filler.code === 0, `the filler file was written (exit ${String(filler.code)})`);

			yield* Effect.forEach(["filler-1.txt", "filler-2.txt"], (file) =>
				Effect.flatMap(run.exec(["stat", "-c", "%s", file]), ({ output }) =>
					run.check(
						Number(output) < DEFAULT_MAX_BYTES,
						`${file} fits one read call of at most ${String(DEFAULT_MAX_BYTES)} bytes (it holds ${Str.trim(output)})`,
					),
				),
			);

			yield* run.root.prompt(
				Arr.join(
					[
						"Use the delegate tool to start one leaf on the model ultra-a/claude-haiku-5-5. Its whole task, word for word:",
						"Read the files filler-1.txt and filler-2.txt with the read tool, one call each. Then run the bash command `sleep 330`, in the foreground. Then reply with the single word done.",
						"Then end your turn without waiting for it.",
					],
					"\n\n",
				),
			);

			const { leaf, data } = yield* run.waitFor("the leaf's cache-miss entry", "10 minutes", ({ delegates }) =>
				Arr.findFirst(delegates, (session) =>
					Option.map(missIn(session.entries), (recorded) => ({ leaf: session, data: recorded.data })),
				),
			);

			yield* run.say(data);

			const idle = Arr.findFirst(data.causes, Cause.guards.Idle);

			yield* run.check(
				Option.exists(idle, ({ ms }) => ms > cacheTtlMs) && data.missedTokens >= 50_000,
				`the leaf recorded an idle miss past 5 minutes of at least 50,000 tokens (it recorded ${String(data.missedTokens)} tokens, causes ${Arr.join(
					Arr.map(data.causes, ({ _tag }) => _tag),
					" ",
				)})`,
			);
			yield* run.check(
				data.prompt < 100_000,
				`the leaf's prompt stayed under 100,000 tokens (it sent ${String(data.prompt)})`,
			);
			yield* run.check(!Arr.some(leaf.entries, isCacheWarm), "nothing warmed the leaf's cache while it slept");
		}),
});
