import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import type { Run } from "#tools/driver/index.ts";
import { Reply } from "./anthropic.fixture.ts";

export const providersOf = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.flatMap(entries, (entry) =>
		entry.type === "message" && entry.message.role === "assistant" ? [entry.message.provider] : [],
	);

export const toolUse = (name: string) => (input: Schema.JsonObject) =>
	Reply.ToolUse({ before: Option.none(), name, input });

/** A JSON string's text for `token`, so a search finds a canary that holds a quote or a backslash. */
const escapedOf = (token: string) => Str.replaceAll('"', String.raw`\"`)(Str.replaceAll("\\", String.raw`\\`)(token));

/** The tokens found in any body, as written or as a JSON string holds them. */
export const foundIn = (bodies: ReadonlyArray<string>) => (tokens: ReadonlyArray<string>) =>
	Arr.filter(tokens, (token) =>
		Arr.some(bodies, (body) => Str.includes(token)(body) || Str.includes(escapedOf(token))(body)),
	);

const Case = Schema.Struct({
	id: Schema.String,
	strata: Schema.Struct({ entry: Schema.Literals(["file-read", "tool-result"]) }),
	canaries: Schema.NonEmptyArray(Schema.String),
	messages: Schema.Array(Schema.Struct({ text: Schema.String })),
});

export type Case = typeof Case.Type;

const decodeCases = Schema.decodeUnknownEffect(Schema.NonEmptyArray(Schema.fromJsonString(Case)));

export const manifestCases = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const manifest = yield* fs.readFileString(`${import.meta.dir}/wire.manifest.jsonl`);

	return yield* decodeCases(Arr.filter(Str.split(manifest, "\n"), Str.isNonEmpty));
});

export const recordText = ({ messages }: Case) =>
	Arr.join(
		Arr.map(messages, ({ text }) => text),
		"\n",
	);

const isWake = (entry: SessionEntry) => entry.type === "custom_message" && entry.customType === entryKind;

export const wakeAnswered = (run: Run) => (count: number) =>
	run.waitFor(`the root's answer to wake ${String(count)}`, "5 minutes", ({ root }) => {
		const wakes = Arr.flatMap(root.entries, (entry, index) => (isWake(entry) ? [index] : []));

		return Option.flatMap(Arr.get(wakes, count - 1), (index) =>
			Option.liftPredicate(providersOf(Arr.drop(root.entries, index + 1)), Arr.isArrayNonEmpty),
		);
	});
