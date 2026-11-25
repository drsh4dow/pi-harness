import { expect, test } from "bun:test";

import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import * as Option from "effect/Option";

import { routerExtensionOf } from "./index.ts";

const command = (name: string, source: SlashCommandInfo["source"], path: string): SlashCommandInfo => ({
	name,
	source,
	sourceInfo: { path, source: "local", scope: "user", origin: "top-level" },
});

const extensionRows = [
	{
		name: "the extension that added /phi",
		commands: [
			command("loop", "extension", "/a/loop.ts"),
			command("phi", "extension", "/r/plugins/pi/extension.mjs"),
		],
		expected: Option.some("/r/plugins/pi/extension.mjs"),
	},
	{
		name: "nothing for a skill named phi",
		commands: [command("phi", "skill", "/s/phi/SKILL.md")],
		expected: Option.none(),
	},
	{ name: "nothing without /phi", commands: [command("loop", "extension", "/a/loop.ts")], expected: Option.none() },
];

test.each(extensionRows)("the router's extension is $name", ({ commands, expected }) => {
	expect(routerExtensionOf(commands)).toEqual(expected);
});
