import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { contentText, type ToolCall } from "@earendil-works/pi-ai";
import { type FileEntry, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type Call, editedPaths, firedBy, firedByGroups, type GuideEvent } from "./events.ts";
import type { GuideOnDisk, Library } from "./guides.ts";
import { noOffer, type Offer, offerOf, type Role } from "./offer.ts";

export type Scope = "product" | "harness" | "trial";

type LoadedBy = "lines" | "path";

interface DelegateCall {
	readonly role: string | undefined;
	readonly model: string | undefined;
	readonly instructionsFile: string | undefined;
	readonly group: string | undefined;
	readonly continues: boolean;
}

/** What one session's file shows about the guides it was offered and used. It holds counts and names, never text. */
export interface SessionFacts {
	readonly started: string;
	readonly role: Role;
	readonly scope: Scope;
	readonly listed: ReadonlySet<string>;
	readonly loaded: ReadonlyMap<GuideOnDisk, LoadedBy>;
	readonly events: ReadonlySet<GuideEvent>;
	readonly delegateCalls: ReadonlyArray<DelegateCall>;
}

interface Named {
	read: boolean;
	edited: boolean;
}

interface Scan {
	readonly byKey: ReadonlyMap<string, GuideOnDisk>;
	readonly guideByMarker: ReadonlyMap<string, GuideOnDisk>;
	readonly seen: Map<GuideOnDisk, Set<string>>;
	readonly named: Map<GuideOnDisk, Named>;
	readonly events: Set<GuideEvent>;
	readonly delegateCalls: Array<DelegateCall>;
	header: { readonly started: string; readonly cwd: string };
	offer: Option.Option<Offer>;
	turns: number;
}

const isMarked = (seen: number, own: number) => seen >= 5 || (own < 6 && seen > 0 && seen >= 0.9 * own);

const foreignLog = '"parentId"';

const reads = new Set(["read", "codemode"]);
const writes = new Set(["edit", "write"]);

const nestedTools = new Set([...writes, "delegate"]);

const guideFile =
	/(?<folder>skills|playbooks|principles|instructions|features\/web)\/(?<file>[\w-]+)(?:\/SKILL\.md|\.md)/gu;

const kindOfFolder = new Map([
	["skills", "skill"],
	["features/web", "skill"],
	["playbooks", "playbook"],
	["principles", "principle"],
]);

const startedName =
	/(?:^|\/)(?<date>\d{4}-\d{2}-\d{2})T(?<hours>\d{2})-(?<minutes>\d{2})-(?<seconds>\d{2})-(?<millis>\d{3})Z_[^/]*\.jsonl$/u;

const harnessFolders = ["/.pi", "pi-agent/pi", "phi-router"];

const scopeOf = (cwd: string): Scope => {
	if (Str.startsWith("/tmp")(cwd)) {
		return "trial";
	}

	return Arr.some(harnessFolders, (folder) => Str.includes(folder)(cwd)) ? "harness" : "product";
};

const shownByMessage = (message: AgentMessage) => {
	if (message.role === "user" || message.role === "toolResult" || message.role === "custom") {
		return contentText(message.content);
	}

	if (message.role === "bashExecution") {
		return message.output;
	}

	return message.role === "branchSummary" || message.role === "compactionSummary" ? message.summary : "";
};

const shownBy = (entry: FileEntry) => {
	if (entry.type === "custom_message") {
		return contentText(entry.content);
	}

	if (entry.type === "compaction") {
		return entry.summary;
	}

	return entry.type === "message" ? shownByMessage(entry.message) : "";
};

const unescaped = (text: string) =>
	Str.replaceAll(
		String.raw`\"`,
		'"',
	)(Str.replaceAll(String.raw`\t`, "\t")(Str.replaceAll(String.raw`\n`, "\n")(text)));

const linesOf = (shown: string) => {
	const lines = Str.split(shown, "\n");

	return Str.includes(String.raw`\n`)(shown) ? [...lines, ...Str.split(unescaped(shown), "\n")] : lines;
};

const see = (scan: Scan, shown: string) => {
	if (shown === "" || Str.includes(foreignLog)(shown)) {
		return;
	}

	for (const line of linesOf(shown)) {
		const trimmed = Str.trim(line);
		const guide = scan.guideByMarker.get(trimmed);

		if (guide !== undefined) {
			scan.seen.set(guide, (scan.seen.get(guide) ?? new Set()).add(trimmed));
		}
	}
};

const isText = Schema.is(Schema.String);
const jsonOf = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const stringArg = (args: ToolCall["arguments"], key: string) => {
	const value = args[key];

	return isText(value) ? value : undefined;
};

const delegateCallOf = (args: ToolCall["arguments"]): DelegateCall => ({
	role: stringArg(args, "role"),
	model: stringArg(args, "model"),
	instructionsFile: stringArg(args, "instructionsFile"),
	group: stringArg(args, "group"),
	continues: args["continues"] !== undefined && args["continues"] !== null && args["continues"] !== "",
});

const guidesNamedIn = (scan: Scan, text: string) =>
	Arr.flatMap([...Str.matchAll(guideFile)(text)], (match) => {
		const folder = match.groups?.["folder"] ?? "";
		const guide = scan.byKey.get(`${kindOfFolder.get(folder) ?? folder}:${match.groups?.["file"] ?? ""}`);

		return guide === undefined ? [] : [guide];
	});

const mark = (scan: Scan, guide: GuideOnDisk, { read, edited }: Named) => {
	const slot = scan.named.get(guide) ?? { read: false, edited: false };

	slot.read ||= read;
	slot.edited ||= edited;
	scan.named.set(guide, slot);
};

const nameGuides = (scan: Scan, each: Call) => {
	for (const guide of guidesNamedIn(scan, each.argsJson)) {
		mark(scan, guide, { read: reads.has(each.tool), edited: writes.has(each.tool) });
	}

	for (const guide of Arr.flatMap(editedPaths(each), (path) => guidesNamedIn(scan, path))) {
		mark(scan, guide, { read: false, edited: true });
	}
};

const call = (scan: Scan, tool: string, args: ToolCall["arguments"]) => {
	const each: Call = { tool, argsJson: Option.getOrElse(jsonOf(args), () => "{}"), path: stringArg(args, "path") };

	for (const event of firedBy(each)) {
		scan.events.add(event);
	}

	nameGuides(scan, each);

	if (tool === "delegate") {
		scan.delegateCalls.push(delegateCallOf(args));
	}
};

type ToolUse = readonly [tool: string, args: ToolCall["arguments"]];

const callsIn = (message: AgentMessage): ReadonlyArray<ToolUse> => {
	if (message.role === "assistant") {
		return Arr.flatMap(message.content, (block): Array<ToolUse> =>
			block.type === "toolCall" ? [[block.name, block.arguments]] : [],
		);
	}

	const nested = message.role === "toolResult" ? (message.nestedCalls?.calls ?? []) : [];

	return Arr.flatMap(nested, ({ name, arguments: args }): Array<ToolUse> =>
		nestedTools.has(name) ? [[name, args ?? {}]] : [],
	);
};

const step = (scan: Scan, entry: FileEntry) => {
	see(scan, shownBy(entry));

	if (entry.type === "session") {
		scan.header = { started: entry.timestamp, cwd: entry.cwd };
	}

	if (entry.type === "message" && entry.message.role === "system" && Option.isNone(scan.offer)) {
		scan.offer = Option.some(offerOf(entry.message));
	}

	if (entry.type === "message" && entry.message.role === "assistant") {
		scan.turns += 1;
	}

	if (entry.type === "message") {
		for (const [tool, args] of callsIn(entry.message)) {
			call(scan, tool, args);
		}
	}
};

const loadedOf = ({ seen, named }: Scan) => {
	const loaded = new Map<GuideOnDisk, LoadedBy>();

	for (const guide of new Set([...seen.keys(), ...named.keys()])) {
		const marked = isMarked(seen.get(guide)?.size ?? 0, guide.ownLines);
		const { read, edited } = named.get(guide) ?? { read: false, edited: false };

		if (!edited && (marked || read)) {
			loaded.set(guide, marked ? "lines" : "path");
		}
	}

	return loaded;
};

const startedGroups = (calls: ReadonlyArray<DelegateCall>) =>
	Arr.flatMap(calls, ({ group, continues }) => (continues || group === undefined || group === "" ? [] : [group]));

const factsFrom = (scan: Scan): SessionFacts => {
	const { listed, role } = Option.getOrElse(scan.offer, () => noOffer);

	return {
		started: scan.header.started,
		role,
		scope: scopeOf(scan.header.cwd),
		listed,
		loaded: loadedOf(scan),
		events: new Set([...scan.events, ...firedByGroups(startedGroups(scan.delegateCalls))]),
		delegateCalls: scan.delegateCalls,
	};
};

export const startOf = (file: string) => {
	const groups = startedName.exec(file)?.groups;

	return groups === undefined
		? Number.NaN
		: Date.parse(
				`${groups["date"]}T${groups["hours"]}:${groups["minutes"]}:${groups["seconds"]}.${groups["millis"]}Z`,
			);
};

export const factsOf = ({ library, text }: { readonly library: Library; readonly text: string }) => {
	const scan: Scan = {
		byKey: new Map(Arr.map(library.guides, (guide) => [`${guide.kind}:${guide.name}`, guide])),
		guideByMarker: library.guideByMarker,
		seen: new Map(),
		named: new Map(),
		events: new Set(),
		delegateCalls: [],
		header: { started: "", cwd: "" },
		offer: Option.none(),
		turns: 0,
	};

	for (const entry of parseSessionEntries(text)) {
		step(scan, entry);
	}

	return scan.turns === 0 ? Option.none<SessionFacts>() : Option.some(factsFrom(scan));
};
