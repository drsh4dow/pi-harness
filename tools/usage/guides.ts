import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import type { GuideKind } from "#src/features/loaded/index.ts";

export interface GuideOnDisk {
	readonly kind: GuideKind;
	readonly name: string;
	readonly ownLines: number;
	readonly hidden: boolean;
}

interface GuideText {
	readonly kind: GuideKind;
	readonly name: string;
	readonly text: string;
}

export interface Library {
	readonly guides: ReadonlyArray<GuideOnDisk>;
	readonly guideByMarker: ReadonlyMap<string, GuideOnDisk>;
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

const ownerOf = (holders: ReadonlyMap<string, ReadonlySet<string>>, guides: ReadonlyArray<GuideOnDisk>) => {
	const byName = new Map(Arr.map(guides, (guide) => [guide.name, guide]));
	const owner = new Map<string, GuideOnDisk>();

	for (const [line, names] of holders) {
		const [name = ""] = names;
		const guide = byName.get(name);

		if (names.size === 1 && guide !== undefined) {
			owner.set(line, guide);
		}
	}

	return owner;
};

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

	const guides = Arr.map(today, ({ kind, name, text }): GuideOnDisk => {
		const own = Arr.filter(markLines(text), onlyBy(name));
		const frontmatter = Str.slice(0, frontmatterSpan)(text);

		return { kind, name, ownLines: new Set(own).size, hidden: Str.includes(hiddenFlag)(frontmatter) };
	});

	return { guides, guideByMarker: ownerOf(holders, guides) };
};
