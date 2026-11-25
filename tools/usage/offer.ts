import type { SystemMessage } from "@earendil-works/pi-ai";
import * as Arr from "effect/Array";
import * as Str from "effect/String";

export type Role = "root" | "owner" | "leaf" | "delegate" | "none";

/** What a session's first system message offered: the guides it listed, and the role its role section names. */
export interface Offer {
	readonly listed: ReadonlySet<string>;
	readonly role: Role;
}

const entryName = /^- (?<name>[a-z0-9-]+)(?: \([^)]*\))?: /gmu;
const xmlName = /<name>(?<name>[a-z0-9-]+)<\/name>/gu;
const skillsList = /<available_skills[\s\S]*?<\/available_skills>/gu;

const blockOf = (tag: string, text: string) => new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, "u").exec(text)?.[0] ?? "";

const namesIn = (text: string) =>
	Arr.flatMap([...Str.matchAll(entryName)(text), ...Str.matchAll(xmlName)(text)], (match) => {
		const name = match.groups?.["name"];

		return name === undefined ? [] : [name];
	});

const skillsBlock = (preamble: string, skills: string | null | undefined) => {
	if (skills === null || skills === undefined || skills === "") {
		const olderPromptLists = Arr.map([...Str.matchAll(skillsList)(preamble)], ([list]) => list);

		return Arr.join(olderPromptLists, "");
	}

	return skills;
};

const roleOf = (block: string): Role => {
	const opening = Str.slice("<role>\n".length, 40)(block);

	if (Str.startsWith("You work for")(opening)) {
		return "root";
	}

	if (Str.includes("an owner")(opening)) {
		return "owner";
	}

	if (Str.includes("a leaf")(opening)) {
		return "leaf";
	}

	return Str.includes("a delegate")(opening) ? "delegate" : "none";
};

export const noOffer: Offer = { listed: new Set(), role: "none" };

export const offerOf = ({ sections }: SystemMessage): Offer => {
	const preamble = sections?.["preamble"] ?? "";

	const blocks = [
		blockOf("principles", preamble),
		blockOf("playbooks", preamble),
		skillsBlock(preamble, sections?.["skills"]),
	];

	return { listed: new Set(Arr.flatMap(blocks, namesIn)), role: roleOf(blockOf("role", preamble)) };
};
