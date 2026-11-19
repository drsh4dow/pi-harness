import { expect, test } from "bun:test";

import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import { before, type Marker, type Timeline, timelineOf, verdictOf } from "./timeline.ts";

const marker: Marker = { guide: "skills/swarm/SKILL.md", line: "Fan out parallel workers and return one report." };

const at = (second: number) => `2026-11-19T10:00:${Str.padStart(2, "0")(String(second))}.000Z`;

const assistant = (second: number, tools: ReadonlyArray<string>) => ({
	type: "message",
	timestamp: at(second),
	message: {
		role: "assistant",
		stopReason: "toolUse",
		content: Arr.map(tools, (name, index) => ({
			type: "toolCall",
			id: `call-${String(index)}`,
			name,
			arguments: {},
		})),
	},
});

const guideResult = (second: number) => ({
	type: "message",
	timestamp: at(second),
	message: { role: "toolResult", isError: false, content: [{ type: "text", text: `# Swarm\n\n${marker.line}\n` }] },
});

const started = (second: number) => ({
	type: "custom",
	timestamp: at(second),
	customType: entryKind,
	data: { type: "delegate-started", handle: `delegate-${String(second)}` },
});

const json = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** One line of a planted session file. */
type Line =
	| ReturnType<typeof assistant>
	| ReturnType<typeof guideResult>
	| ReturnType<typeof started>
	| { readonly type: "session"; readonly id: string };

const jsonLine = (entry: Line) => Option.getOrElse(json(entry), () => "");

const timelineFrom = (entries: ReadonlyArray<Line>): Timeline => {
	const text = Arr.join(Arr.map([{ type: "session" as const, id: "root" }, ...entries], jsonLine), "\n");

	const parsed = Arr.filter(parseSessionEntries(text), (entry): entry is SessionEntry => entry.type !== "session");
	const root = { id: "root", file: "root.jsonl", entries: parsed, loaded: Option.none(), requests: [] };

	return timelineOf({ sessions: { root, delegates: [] }, markers: [marker] });
};

const fanOut = (timeline: Timeline) =>
	Option.map(
		Arr.findFirst(timeline.steps, (step) => step.started >= 3),
		before,
	);

const kindOf = (timeline: Timeline) => verdictOf({ timeline, guides: [marker.guide], window: fanOut(timeline) }).kind;

test("a guide read in an earlier message than the delegate starts is a hit", () => {
	const timeline = timelineFrom([
		assistant(1, ["read"]),
		guideResult(2),
		assistant(3, ["codemode"]),
		started(4),
		started(4),
		started(4),
	]);

	expect(kindOf(timeline)).toBe("hit");
});

test("a guide read in the same message that starts the delegates is a miss", () => {
	const timeline = timelineFrom([
		assistant(1, ["read", "delegate", "delegate", "delegate"]),
		started(2),
		started(2),
		started(2),
		guideResult(3),
	]);

	expect(kindOf(timeline)).toBe("miss");
});

test("a run that never starts three delegates is no event, not a miss", () => {
	const timeline = timelineFrom([assistant(1, ["delegate", "delegate"]), started(2), started(2)]);

	expect(kindOf(timeline)).toBe("no-event");
});
