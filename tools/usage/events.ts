import * as Arr from "effect/Array";
import * as Str from "effect/String";

type Trigger =
	| { readonly kind: "call"; readonly pattern: RegExp }
	| { readonly kind: "edit"; readonly pattern: RegExp }
	| { readonly kind: "group"; readonly size: number };

/** A moment the guides it names are written for. */
export interface GuideEvent {
	readonly name: string;
	readonly guides: ReadonlyArray<string>;
	readonly trigger: Trigger;
}

/** One tool call as the session stored it, its arguments as JSON text. */
export interface Call {
	readonly tool: string;
	readonly args: string;
	/** The `path` argument of an edit or a write. */
	readonly path: string | undefined;
}

const call = (pattern: RegExp): Trigger => ({ kind: "call", pattern });
const edit = (pattern: RegExp): Trigger => ({ kind: "edit", pattern });

export const guideEvents: ReadonlyArray<GuideEvent> = [
	{ name: "git commit", guides: ["writing-good-commits"], trigger: call(/git (?:-C \S+ )?commit\b/u) },
	{
		name: "create a PR",
		guides: ["writing-good-prs", "no-comments"],
		trigger: call(/gh pr create\b|publish-pr\.ts\\?"?\s+create\b/u),
	},
	{
		name: "create a ticket",
		guides: ["writing-good-tickets"],
		trigger: call(/gh issue create\b|(?:create|save)_issue\b/u),
	},
	{
		name: "edit a migration or schema",
		guides: ["blast-radius"],
		trigger: edit(/\/migrations?\/|\.sql$|schema\.(?:ts|prisma)$/u),
	},
	{ name: "edit .ts", guides: ["typescript-best-practices"], trigger: edit(/\.tsx?$/u) },
	{ name: "edit GLOSSARY", guides: ["domain-modeling"], trigger: edit(/GLOSSARY[^/]*\.md$/u) },
	{ name: "edit an ADR", guides: ["documentation-and-adrs"], trigger: edit(/\/adr\/[^/]+\.md$/u) },
	{ name: "group of 3+ delegates", guides: ["swarm"], trigger: { kind: "group", size: 3 } },
	{ name: "write USER_ACTION_ITEMS", guides: ["wizard"], trigger: edit(/USER_ACTION_ITEMS\.md$/u) },
	{
		name: "media reference",
		guides: ["dumpfile"],
		trigger: call(/!\[[^\]]*\]\([^)]+\.(?:png|gif|jpe?g|mp4|webm)|<(?:img|video) |user-attachments\/assets/u),
	},
];

const callTools = new Set(["bash", "codemode", "watch", "serve", "write"]);

const codemodeEdit = /tools\.(?:edit|write)\(\{\s*\\?"?path\\?"?:\s*[\\"'`]+(?<path>[^"'`\\]+)/gu;

/**
 * The paths a call edits or writes, including the literal paths a codemode script hands to `tools.edit` or `tools.write`.
 * A path the script computes is missing here, and shows up in the nested call pi records instead.
 */
export const editedPaths = ({ tool, args, path }: Call) => {
	if (tool === "edit" || tool === "write") {
		return [path ?? ""];
	}

	return tool === "codemode"
		? Arr.map([...Str.matchAll(codemodeEdit)(args)], (match) => match.groups?.["path"] ?? "")
		: [];
};

const fires = (trigger: Trigger, each: Call, paths: ReadonlyArray<string>) => {
	if (trigger.kind === "call") {
		return callTools.has(each.tool) && trigger.pattern.test(each.args);
	}

	return trigger.kind === "edit" && Arr.some(paths, (path) => trigger.pattern.test(path));
};

/** The events one tool call fires. */
export const firedBy = (each: Call): ReadonlyArray<GuideEvent> => {
	const paths = editedPaths(each);

	return Arr.filter(guideEvents, ({ trigger }) => fires(trigger, each, paths));
};

/** The events a session's new delegates fire, given the group each one joined. A continuation is not a new delegate. */
export const firedByGroups = (groups: ReadonlyArray<string>): ReadonlyArray<GuideEvent> => {
	const sizes = new Map<string, number>();

	for (const group of groups) {
		sizes.set(group, (sizes.get(group) ?? 0) + 1);
	}

	const largest = Math.max(0, ...sizes.values());

	return Arr.filter(guideEvents, ({ trigger }) => trigger.kind === "group" && largest >= trigger.size);
};
