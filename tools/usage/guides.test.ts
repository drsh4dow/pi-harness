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
