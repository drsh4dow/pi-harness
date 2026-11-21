import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Num from "effect/Number";
import * as Str from "effect/String";

import { runGit } from "#src/client/gh/index.ts";

const kinds = ["production", "tests", "docs", "other"] as const;

type Kind = (typeof kinds)[number];

const lockOrSnapshot = /(?:^|\/)(?:[^/]+\.lockb?|[^/]+-lock\.(?:json|ya?ml)|go\.sum)$|\.snap$|(?:^|\/)__snapshots__\//u;

const testPath = /(?:^|\/)(?:__tests__|tests?|specs?|fixtures?)\/|[._-](?:test|spec|scenario|fixture)\.[^/]+$/u;

const docPath = /\.(?:md|mdx|rst)$|(?:^|\/)docs?\//u;

const generated = "linguist-generated";

const documentation = "linguist-documentation";

const isSet = (value: string | undefined) => value === "set" || value === "true";

/** `linguist-generated` in `.gitattributes` makes a path other, and `linguist-documentation` set or unset overrides the docs rule. */
const kindOf = (path: string, attribute: (name: string) => string | undefined): Kind => {
	if (isSet(attribute(generated)) || lockOrSnapshot.test(path)) {
		return "other";
	}

	if (testPath.test(path)) {
		return "tests";
	}

	const marked = attribute(documentation);
	const isDocs = marked === "unspecified" ? docPath.test(path) : isSet(marked);

	return isDocs ? "docs" : "production";
};

const count = (column: string) => (column === "-" ? 0 : Number(column));

const changesOf = (numstat: string) =>
	Arr.flatMap(Str.split(numstat, "\0"), (record) => {
		const [added, deleted = "", ...path] = Str.split(record, "\t");

		return Str.isNonEmpty(added)
			? [{ path: Arr.join(path, "\t"), added: count(added), deleted: count(deleted) }]
			: [];
	});

const attributesOf = (checkAttr: string) => {
	const fields = Arr.dropRight(Str.split(checkAttr, "\0"), 1);
	const triples = Arr.chunksOf(fields, 3);

	return new Map(Arr.map(triples, ([path, name, value]) => [`${path}\0${name ?? ""}`, value]));
};

/** One line that sizes `<base>...<head>` by kind of path, with binary files as zero lines. */
export const diffSize = Effect.fn("diffSize")(function* (base: string, head: string) {
	const mergeBase = yield* Effect.map(runGit({ args: ["merge-base", base, head] }), Str.trim);
	const numstat = yield* runGit({ args: ["diff", "--numstat", "-z", "--no-renames", mergeBase, head] });
	const changes = changesOf(numstat);

	const checkAttr = yield* runGit({
		args: ["check-attr", "-z", "--stdin", "--source", head, generated, documentation],
		input: Arr.join(
			Arr.map(changes, ({ path }) => `${path}\0`),
			"",
		),
	});

	const attributes = attributesOf(checkAttr);

	const classified = Arr.map(changes, (change) => ({
		...change,
		kind: kindOf(change.path, (name) => attributes.get(`${change.path}\0${name}`)),
	}));

	const sizes = Arr.map(kinds, (kind) => {
		const ofKind = Arr.filter(classified, (change) => change.kind === kind);
		const added = Num.sumAll(Arr.map(ofKind, (change) => change.added));
		const deleted = Num.sumAll(Arr.map(ofKind, (change) => change.deleted));

		return `${kind} +${String(added)} -${String(deleted)}`;
	});

	return `size: ${Arr.join(sizes, ", ")} (base ${Str.slice(0, 7)(mergeBase)})`;
});
