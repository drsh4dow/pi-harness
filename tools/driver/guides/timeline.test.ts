import { expect, test } from "bun:test";

import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import type { Session, Sessions } from "#tools/driver/index.ts";
import {
	before,
	firstStep,
	type Marker,
	reportOf,
	type Timeline,
	timelineOf,
	verdictOf,
	writesFile,
} from "./timeline.ts";

const marker: Marker = { guide: "skills/swarm/SKILL.md", line: "Fan out parallel workers and return one report." };

const principle: Marker = {
	guide: "principles/fix-root-causes.md",
	line: "Fix the cause, not the place it showed up.",
};

const delegatePrinciple: Marker = { guide: "principles/prove-it-works.md", line: "Check the real thing directly." };

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

const resultHolding = (second: number, line: string) => ({
	type: "message",
	timestamp: at(second),
	message: { role: "toolResult", isError: false, content: [{ type: "text", text: `# Guide\n\n${line}\n` }] },
});

const guideResult = (second: number) => resultHolding(second, marker.line);

const started = (second: number) => ({
	type: "custom",
	timestamp: at(second),
	customType: entryKind,
	data: { type: "delegate-started", handle: `delegate-${String(second)}` },
});

const json = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

type Line =
	| ReturnType<typeof assistant>
	| ReturnType<typeof resultHolding>
	| ReturnType<typeof started>
	| { readonly type: "session"; readonly id: string };

const jsonLine = (entry: Line) => Option.getOrElse(json(entry), () => "");

const sessionOf = (id: string, entries: ReadonlyArray<Line>): Session => {
	const text = Arr.join(Arr.map([{ type: "session" as const, id }, ...entries], jsonLine), "\n");

	const parsed = Arr.filter(parseSessionEntries(text), (entry): entry is SessionEntry => entry.type !== "session");

	return { id, file: `${id}.jsonl`, entries: parsed, loaded: Option.none(), requests: [] };
};

const rootOnly = (entries: ReadonlyArray<Line>): Sessions => ({ root: sessionOf("root", entries), delegates: [] });

const timelineFrom = (entries: ReadonlyArray<Line>): Timeline =>
	timelineOf({ sessions: rootOnly(entries), markers: [marker] });

const fanOut = (timeline: Timeline) =>
	Option.map(
		Arr.findFirst(timeline.steps, (step) => step.delegatesStarted >= 3),
		before,
	);

const kindOf = (timeline: Timeline) => verdictOf({ timeline, guides: [marker.guide], window: fanOut(timeline) });

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

test("a guide read in the same message that starts the delegates is a miss, even when its result lands first", () => {
	const timeline = timelineFrom([
		assistant(1, ["read", "delegate", "delegate", "delegate"]),
		guideResult(2),
		started(3),
		started(3),
		started(3),
	]);

	expect(kindOf(timeline)).toBe("miss");
});

test("a run that never starts three delegates is no event, not a miss", () => {
	const timeline = timelineFrom([assistant(1, ["delegate", "delegate"]), started(2), started(2)]);

	expect(kindOf(timeline)).toBe("no-event");
});

test("a window counts a read from the second it opens until before the second it closes", () => {
	const window = Option.some({ opens: Option.some(at(3)), closes: at(5) });

	const kinds = Arr.map([2, 3, 4, 5], (second) =>
		verdictOf({ timeline: timelineFrom([guideResult(second)]), guides: [marker.guide], window }),
	);

	expect(kinds).toEqual(["miss", "hit", "hit", "miss"]);
});

test("a run that read only one of the guides it measures is a miss", () => {
	const window = Option.some({ opens: Option.none(), closes: at(9) });
	const guides = [marker.guide, principle.guide];

	const verdict = (entries: ReadonlyArray<Line>) =>
		verdictOf({
			timeline: timelineOf({ sessions: rootOnly(entries), markers: [marker, principle] }),
			guides,
			window,
		});

	expect([verdict([guideResult(2)]), verdict([guideResult(2), resultHolding(3, principle.line)])]).toEqual([
		"miss",
		"hit",
	]);
});

test("a run read again later keeps the step that matched first, whichever session took it", () => {
	const delegate = sessionOf("delegate", [assistant(2, ["write"])]);

	const firstWrite = (rootEntries: ReadonlyArray<Line>) => {
		const sessions = { root: sessionOf("root", rootEntries), delegates: [delegate] };
		const timeline = timelineOf({ sessions, markers: [marker] });

		return Option.map(firstStep({ timeline, matches: writesFile }), ({ at: time, by }) => ({ at: time, by }));
	};

	const earlier = firstWrite([assistant(1, ["read"])]);
	const later = firstWrite([assistant(1, ["read"]), assistant(3, ["write"])]);

	expect([earlier, later]).toEqual([
		Option.some({ at: at(2), by: "delegate" }),
		Option.some({ at: at(2), by: "delegate" }),
	]);
});

test("a call may write a file when it is a write or an edit, or a script with a heredoc or a write in it", () => {
	const calls = [
		{ tool: "write", argumentsJson: '{"path":"a.md"}' },
		{ tool: "edit", argumentsJson: '{"path":"a.md"}' },
		{ tool: "bash", argumentsJson: '{"command":"cat > a.md <<EOF"}' },
		{ tool: "codemode", argumentsJson: '{"code":"await tools.write({ path })"}' },
		{ tool: "codemode", argumentsJson: '{"code":"await tools.edit({ path })"}' },
		{ tool: "bash", argumentsJson: '{"command":"ls"}' },
		{ tool: "codemode", argumentsJson: '{"code":"await tools.read({ path })"}' },
		{ tool: "read", argumentsJson: '{"path":"notes <<EOF.md"}' },
	];

	expect(Arr.map(calls, (call) => writesFile({ ...call, path: Option.none() }))).toEqual([
		true,
		true,
		true,
		true,
		true,
		false,
		false,
		false,
	]);
});

test("a report prints the reads of the measured guides, the window and the principles the root read, and ends on the verdict line", () => {
	const root = {
		...sessionOf("root", [
			assistant(1, ["read", "read"]),
			guideResult(2),
			resultHolding(3, principle.line),
			assistant(4, ["delegate", "delegate", "delegate"]),
			started(5),
			started(5),
			started(5),
		]),
		loaded: Option.some({
			version: "1.5.2",
			model: "p/m",
			contextWindow: 40_000,
			extensions: [],
			settings: {},
			modelsError: Option.none(),
			socket: Option.none(),
		}),
	};

	const sessions = { root, delegates: [sessionOf("delegate", [resultHolding(6, delegatePrinciple.line)])] };
	const timeline = timelineOf({ sessions, markers: [marker, principle, delegatePrinciple] });

	expect(reportOf({ sessions, timeline, guides: [marker.guide], event: fanOut, ended: "event" })).toEqual([
		`read skills/swarm/SKILL.md at ${at(2)} by root`,
		`event from start to ${at(4)}`,
		"principles fix-root-causes",
		"verdict hit p/m event",
	]);
});
