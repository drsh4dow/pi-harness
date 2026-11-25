import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import { settledReply } from "#tools/driver/align/index.ts";
import type { Session, Sessions } from "#tools/driver/index.ts";

/** A guide by its path inside the agent folder. */
export type GuideFile = `skills/${string}/SKILL.md` | `playbooks/${string}.md` | `principles/${string}.md`;

type Actor = "root" | "delegate";

/** One tool call: the tool, its `path` argument if it has one, and its arguments as JSON. */
export interface Call {
	readonly tool: string;
	readonly path: Option.Option<string>;
	readonly text: string;
}

/**
 * One assistant message, at the time pi appended it. pi appends it before any of its tool results, so a guide its
 * calls read arrives after it, and a read in the same message as an event is never before that event.
 */
interface Step {
	readonly at: string;
	readonly by: Actor;
	readonly turn: number;
	readonly calls: ReadonlyArray<Call>;
	readonly delegatesStarted: number;
}

interface Read {
	readonly guide: GuideFile;
	readonly at: string;
	readonly by: Actor;
}

/** A run so far, every session on one clock. It only grows, so the first step that matches stays the first. */
export interface Timeline {
	readonly steps: ReadonlyArray<Step>;
	readonly reads: ReadonlyArray<Read>;
	/** The root's last turn-ending message, once every job it started has settled. */
	readonly finalReply: Option.Option<{ readonly at: string; readonly text: string }>;
}

/** A hit needs each guide read at or after `opens`, from the run's start when none, and before `closes`. */
export interface Window {
	readonly opens: Option.Option<string>;
	readonly closes: string;
}

/** A guide and the line of its body that shows it reached a session. */
export interface Marker {
	readonly guide: GuideFile;
	readonly line: string;
}

export const before = ({ at }: { readonly at: string }): Window => ({ opens: Option.none(), closes: at });

const DelegateStarted = Schema.Struct({
	type: Schema.Literal("custom"),
	customType: Schema.Literal(entryKind),
	data: Schema.Struct({ type: Schema.Literal("delegate-started") }),
});

const isStart = Schema.is(DelegateStarted);

const pathOf = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String }));

const jsonOf = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

type Message = Extract<SessionEntry, { type: "message" }>["message"];

type Assistant = Extract<Message, { role: "assistant" }>;

type ToolResult = Extract<Message, { role: "toolResult" }>;

const assistantOf = (entry: SessionEntry): Option.Option<Assistant> =>
	entry.type === "message" && entry.message.role === "assistant" ? Option.some(entry.message) : Option.none();

const resultOf = (entry: SessionEntry): Option.Option<ToolResult> =>
	entry.type === "message" && entry.message.role === "toolResult" && !entry.message.isError
		? Option.some(entry.message)
		: Option.none();

const endsTurn = (message: Assistant) => message.stopReason !== "toolUse";

const callsOf = (message: Assistant): ReadonlyArray<Call> =>
	Arr.flatMap(message.content, (part) =>
		part.type === "toolCall"
			? [
					{
						tool: part.name,
						path: Option.map(pathOf(part.arguments), ({ path }) => path),
						text: Option.getOrElse(jsonOf(part.arguments), () => ""),
					},
				]
			: [],
	);

const stepsOf = ({ session, by }: { readonly session: Session; readonly by: Actor }): ReadonlyArray<Step> => {
	const assistants = Arr.getSomes(
		Arr.map(session.entries, (entry, index) =>
			Option.map(assistantOf(entry), (message) => ({ index, at: entry.timestamp, message })),
		),
	);

	return Arr.map(assistants, ({ index, at, message }, position) => {
		const next = Option.match(Arr.get(assistants, position + 1), {
			onNone: () => session.entries.length,
			onSome: (later) => later.index,
		});

		return {
			at,
			by,
			turn: Arr.filter(Arr.take(assistants, position), (earlier) => endsTurn(earlier.message)).length,
			calls: callsOf(message),
			delegatesStarted: Arr.filter(session.entries.slice(index + 1, next), isStart).length,
		};
	});
};

const textOf = (result: ToolResult) =>
	Arr.join(
		Arr.flatMap(result.content, (part) => (part.type === "text" ? [part.text] : [])),
		"\n",
	);

const readsOf =
	(markers: ReadonlyArray<Marker>) =>
	({ session, by }: { readonly session: Session; readonly by: Actor }): ReadonlyArray<Read> =>
		Arr.flatMap(session.entries, (entry) =>
			Option.match(resultOf(entry), {
				onNone: () => [],
				onSome: (result) => {
					const text = textOf(result);

					return Arr.flatMap(markers, ({ guide, line }) =>
						Str.includes(line)(text) ? [{ guide, at: entry.timestamp, by }] : [],
					);
				},
			}),
		);

const byTime = <Item extends { readonly at: string }>(items: ReadonlyArray<Item>) =>
	Arr.sort(
		items,
		Order.mapInput(Order.String, (item: Item) => item.at),
	);

export const timelineOf = ({
	sessions,
	markers,
}: {
	readonly sessions: Sessions;
	readonly markers: ReadonlyArray<Marker>;
}): Timeline => {
	const everyone = [
		{ session: sessions.root, by: "root" as const },
		...Arr.map(sessions.delegates, (session) => ({ session, by: "delegate" as const })),
	];

	const lastEnd = Arr.findLast(sessions.root.entries, (entry) => Option.exists(assistantOf(entry), endsTurn));

	return {
		steps: byTime(Arr.flatMap(everyone, stepsOf)),
		reads: byTime(Arr.flatMap(everyone, readsOf(markers))),
		finalReply: Option.flatMap(settledReply(sessions.root), (text) =>
			Option.map(lastEnd, ({ timestamp }) => ({ at: timestamp, text })),
		),
	};
};

type Verdict = "hit" | "miss" | "no-event";

/** Pure. A hit when every guide was read inside the window. */
export const verdictOf = ({
	timeline,
	guides,
	window,
}: {
	readonly timeline: Timeline;
	readonly guides: ReadonlyArray<GuideFile>;
	readonly window: Option.Option<Window>;
}): Verdict =>
	Option.match(window, {
		onNone: () => "no-event",
		onSome: ({ opens, closes }) => {
			const inside = (read: Read) => read.at < closes && !Option.exists(opens, (from) => read.at < from);

			const allRead = Arr.every(guides, (guide) =>
				Arr.some(timeline.reads, (read) => read.guide === guide && inside(read)),
			);

			return allRead ? "hit" : "miss";
		},
	});

/**
 * Whether `call` may write a file: a write or an edit, or a bash command or codemode script with a heredoc or a write
 * in it, whose path stays unknown. Counting those makes an event that closes at a write close early, never late.
 */
export const writesFile = ({ tool, text }: Call) => {
	if (tool === "write" || tool === "edit") {
		return true;
	}

	const scripted = tool === "bash" || tool === "codemode";

	return (
		scripted && (Str.includes("<<")(text) || Str.includes("tools.write")(text) || Str.includes("tools.edit")(text))
	);
};

export const firstStep = ({
	timeline,
	matches,
}: {
	readonly timeline: Timeline;
	readonly matches: (call: Call) => boolean;
}) => Arr.findFirst(timeline.steps, (step) => Arr.some(step.calls, matches));

/** What stopped the run: its event, the root's final reply, or the time budget. */
export type Ended = "event" | "settled" | "budget";

const readLines = ({ timeline, guide }: { readonly timeline: Timeline; readonly guide: GuideFile }) => {
	const reads = Arr.filter(timeline.reads, (read) => read.guide === guide);

	return Arr.isReadonlyArrayNonEmpty(reads)
		? Arr.map(reads, ({ at, by }) => `read ${guide} at ${at} by ${by}`)
		: [`read ${guide} never`];
};

/**
 * Pure. The lines a run prints: each read of the measured guides, the event's window, the principles the root read,
 * and last `verdict <hit|miss|no-event> <model> <ended>`, the line the table counts.
 */
export const reportOf = ({
	sessions,
	timeline,
	guides,
	event,
	ended,
}: {
	readonly sessions: Sessions;
	readonly timeline: Timeline;
	readonly guides: ReadonlyArray<GuideFile>;
	readonly event: (timeline: Timeline) => Option.Option<Window>;
	readonly ended: Ended;
}): ReadonlyArray<string> => {
	const window = event(timeline);
	const verdict = verdictOf({ timeline, guides, window });
	const model = Option.match(sessions.root.loaded, { onNone: () => "unknown", onSome: (loaded) => loaded.model });

	const principles = Arr.dedupe(
		Arr.flatMap(timeline.reads, ({ guide, by }) =>
			by === "root" && Str.startsWith("principles/")(guide)
				? [Str.replaceAll(/^principles\/|\.md$/gu, "")(guide)]
				: [],
		),
	);

	const span = Option.match(window, {
		onNone: () => `event none in ${String(timeline.steps.length)} steps`,
		onSome: ({ opens, closes }) => `event from ${Option.getOrElse(opens, () => "start")} to ${closes}`,
	});

	return [
		...Arr.flatMap(guides, (guide) => readLines({ timeline, guide })),
		span,
		`principles ${Arr.join(principles, ", ") || "none"}`,
		`verdict ${verdict} ${model} ${ended}`,
	];
};
