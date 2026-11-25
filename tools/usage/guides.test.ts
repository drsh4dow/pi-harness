import { expect, test } from "bun:test";

import * as Arr from "effect/Array";

import { libraryOf } from "./guides.ts";

const file = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}\n`;

test("a guide whose frontmatter turns off model invocation is hidden", () => {
	const { guides } = libraryOf({
		today: [
			{ kind: "skill", name: "menu-only", text: file("name: menu-only\ndisable-model-invocation: true", "body") },
			{ kind: "skill", name: "offered", text: file("name: offered\ndisable-model-invocation: false", "body") },
		],
		past: [],
	});

	expect(Arr.map(guides, ({ name, hidden }) => [name, hidden])).toEqual([
		["menu-only", true],
		["offered", false],
	]);
});

test("a line only an older version of a guide held still marks it, though it was a skill then and is a playbook now", () => {
	const older = "The wording this guide had as a skill, long enough to mark it.";

	const { guideByMarker } = libraryOf({
		today: [{ kind: "playbook", name: "swarm", text: file("name: swarm", "The wording this playbook has today.") }],
		past: [{ name: "swarm", text: file("name: swarm", older) }],
	});

	expect(guideByMarker.get(older)?.name).toBe("swarm");
});
