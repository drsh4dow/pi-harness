import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import type { GuideKind } from "#src/features/loaded/index.ts";

/** A guide on disk now. */
export interface Guide {
	readonly kind: GuideKind;
	readonly name: string;
	readonly ownLines: number;
	/** Only a person can invoke it, since its frontmatter sets `disable-model-invocation: true`. */
	readonly hidden: boolean;
}

interface GuideText {
	readonly kind: GuideKind;
	readonly name: string;
	readonly text: string;
}

/** The guides on disk, and each line that marks one of them wherever its text lands. */
export interface Library {
	readonly guides: ReadonlyArray<Guide>;
	readonly owner: ReadonlyMap<string, Guide>;
}

const minMarkerLength = 20;
const fence = "---";
const hiddenFlag = "disable-model-invocation: true";
const frontmatterSpan = 600;

const bodyOf = (text: string) => {
	const close = Str.indexOf(fence)(Str.slice(fence.length)(text));

	return Str.startsWith(fence)(text) && Option.isSome(close) ? Str.slice(2 * fence.length + close.value)(text) : text;
};

const markLines = (text: string) => {
	const lines = Arr.map(Str.split(bodyOf(text), "\n"), (line) => Str.trim(line));

	return Arr.filter(lines, (line) => line.length >= minMarkerLength);
};

const holdersOf = (texts: ReadonlyArray<Pick<GuideText, "name" | "text">>) => {
	const holders = new Map<string, Set<string>>();

	for (const { name, text } of texts) {
		for (const line of markLines(text)) {
			holders.set(line, (holders.get(line) ?? new Set()).add(name));
		}
	}

	return holders;
};

const ownerOf = (holders: ReadonlyMap<string, ReadonlySet<string>>, guides: ReadonlyArray<Guide>) => {
	const byName = new Map(Arr.map(guides, (guide) => [guide.name, guide]));
	const owner = new Map<string, Guide>();

	for (const [line, names] of holders) {
		const [name = ""] = names;
		const guide = byName.get(name);

		if (names.size === 1 && guide !== undefined) {
			owner.set(line, guide);
		}
	}

	return owner;
};

/**
 * Keeps, for each guide on disk, the body lines that only it has ever held, so an older wording still marks it.
 * `past` holds every version git has of each guide file, named by its folder or file alone, since some skills became
 * playbooks.
 */
export const libraryOf = ({
	today,
	past,
}: {
	readonly today: ReadonlyArray<GuideText>;
	readonly past: ReadonlyArray<Pick<GuideText, "name" | "text">>;
}): Library => {
	const holders = holdersOf([...past, ...today]);

	const onlyBy = (name: string) => (line: string) =>
		holders.get(line)?.size === 1 && holders.get(line)?.has(name) === true;

	const guides = Arr.map(today, ({ kind, name, text }): Guide => {
		const own = Arr.filter(markLines(text), onlyBy(name));
		const frontmatter = Str.slice(0, frontmatterSpan)(text);

		return { kind, name, ownLines: new Set(own).size, hidden: Str.includes(hiddenFlag)(frontmatter) };
	});

	return { guides, owner: ownerOf(holders, guides) };
};
