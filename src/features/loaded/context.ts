import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import { parseFrontmatter, type ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

const Kind = Schema.Literals(["skill", "principle", "playbook"]);

export type GuideKind = typeof Kind.Type;

export interface Guide {
	readonly kind: GuideKind;
	readonly name: string;
	readonly path: string;
	readonly lines: ReadonlyArray<string>;
}

export const Loaded = Schema.Struct({
	kind: Kind,
	name: Schema.String,
	path: Schema.String,
	state: Schema.Literals(["full", "partial"]),
	by: Schema.Literals(["agent", "person"]),
});

export type Loaded = typeof Loaded.Type;

type Loader = Loaded["by"];

const minLineLength = 20;
const fullShare = 0.9;
const partialLines = 3;

const markLines = (text: string) =>
	Arr.filter(
		Arr.map(Str.split(text, "\n"), (line) => Str.trim(line)),
		(line) => line.length >= minLineLength,
	);

export const guidesOf = (
	files: ReadonlyArray<{
		readonly kind: GuideKind;
		readonly name: string;
		readonly path: string;
		readonly text: string;
	}>,
): ReadonlyArray<Guide> => {
	const bodies = Arr.map(files, (file) => Arr.dedupe(markLines(parseFrontmatter(file.text).body)));
	const owners = new Map<string, number>();

	for (const lines of bodies) {
		for (const line of lines) {
			owners.set(line, (owners.get(line) ?? 0) + 1);
		}
	}

	return Arr.map(files, ({ kind, name, path }, index) => ({
		kind,
		name,
		path,
		lines: Arr.filter(bodies[index] ?? [], (line) => owners.get(line) === 1),
	}));
};

const unescaped = (text: string) =>
	Str.replaceAll(
		String.raw`\"`,
		'"',
	)(Str.replaceAll(String.raw`\t`, "\t")(Str.replaceAll(String.raw`\n`, "\n")(text)));

const visibleText = (message: AgentMessage) => {
	if (message.role === "assistant" || message.role === "system") {
		return "";
	}

	if (message.role === "bashExecution") {
		return message.output;
	}

	if (message.role === "branchSummary" || message.role === "compactionSummary") {
		return message.summary;
	}

	return contentText(message.content, "\n");
};

const loaderOf = (message: AgentMessage): Loader =>
	message.role === "user" || message.role === "bashExecution" ? "person" : "agent";

interface Marker {
	readonly guideAt: number;
	readonly lineAt: number;
}

type Marks = ReadonlyMap<Marker["guideAt"], ReadonlySet<Marker["lineAt"]>>;

export interface Index {
	readonly guides: ReadonlyArray<Guide>;
	readonly markerByLine: ReadonlyMap<string, Marker>;
	readonly marksByMessage: WeakMap<AgentMessage, Marks>;
}

export const indexOf = (guides: ReadonlyArray<Guide>): Index => ({
	guides,
	markerByLine: new Map(
		Arr.flatMap(guides, (guide, guideAt) => Arr.map(guide.lines, (line, lineAt) => [line, { guideAt, lineAt }])),
	),
	marksByMessage: new WeakMap(),
});

const marksIn = (index: Index, text: string): Marks => {
	const marks = new Map<Marker["guideAt"], Set<Marker["lineAt"]>>();

	for (const line of [...markLines(text), ...markLines(unescaped(text))]) {
		const marker = index.markerByLine.get(line);

		if (marker !== undefined) {
			marks.set(marker.guideAt, (marks.get(marker.guideAt) ?? new Set()).add(marker.lineAt));
		}
	}

	return marks;
};

const marksOf = (index: Index, message: AgentMessage) => {
	const cached = index.marksByMessage.get(message);

	if (cached !== undefined) {
		return cached;
	}

	const marks = marksIn(index, visibleText(message));
	index.marksByMessage.set(message, marks);

	return marks;
};

const stateOf = (seen: number, total: number) => {
	if (seen >= total * fullShare) {
		return "full";
	}

	return seen >= Math.min(partialLines, total) ? "partial" : undefined;
};

export const inContext = ({
	index,
	entries,
}: {
	readonly index: Index;
	readonly entries: ReadonlyArray<ProjectedSessionEntry>;
}): ReadonlyArray<Loaded> => {
	const found = new Map<number, { readonly lines: Set<number>; readonly by: Loader }>();

	for (const message of Arr.flatMap(entries, (entry) => entry.messages)) {
		for (const [guide, lines] of marksOf(index, message)) {
			const prior = found.get(guide);

			if (prior === undefined) {
				found.set(guide, { lines: new Set(lines), by: loaderOf(message) });
			} else {
				for (const line of lines) {
					prior.lines.add(line);
				}
			}
		}
	}

	return Arr.flatMap([...found], ([at, { lines, by }]) => {
		const guide = index.guides[at];
		const state = guide === undefined ? undefined : stateOf(lines.size, guide.lines.length);

		return guide === undefined || state === undefined
			? []
			: [{ kind: guide.kind, name: guide.name, path: guide.path, state, by }];
	});
};
