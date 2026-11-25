import { expect, test } from "bun:test";

import * as Arr from "effect/Array";

import { firedBy, firedByGroups } from "./events.ts";

const names = (events: ReadonlyArray<{ readonly name: string }>) => Arr.map(events, ({ name }) => name);

const cases = [
	{
		tool: "bash",
		argsJson: String.raw`{"command":"git -C /repo commit -m \"x\""}`,
		path: undefined,
		fired: ["git commit"],
	},
	{ tool: "read", argsJson: '{"path":"notes/git commit.md"}', path: "notes/git commit.md", fired: [] },
	{
		tool: "bash",
		argsJson: String.raw`{"command":"gh pr create --body \"![demo](https://x.test/demo.gif)\""}`,
		path: undefined,
		fired: ["create a PR", "media reference"],
	},
	{
		tool: "bash",
		argsJson:
			'{"command":"bun /home/u/.pi/agent/skills/writing-good-prs/scripts/publish-pr.ts create /tmp/body.md --title x"}',
		path: undefined,
		fired: ["create a PR"],
	},
	{ tool: "bash", argsJson: '{"command":"gh issue create --title t"}', path: undefined, fired: ["create a ticket"] },
	{ tool: "edit", argsJson: "{}", path: "src/app.ts", fired: ["edit .ts"] },
	{ tool: "write", argsJson: "{}", path: "db/migrations/0001_init.sql", fired: ["edit a migration or schema"] },
	{ tool: "write", argsJson: "{}", path: "docs/adr/0003-routing.md", fired: ["edit an ADR"] },
	{ tool: "write", argsJson: "{}", path: "/state/USER_ACTION_ITEMS.md", fired: ["write USER_ACTION_ITEMS"] },
	{
		tool: "codemode",
		argsJson: String.raw`{"code":"await tools.edit({ \"path\": \"/repo/GLOSSARY.md\", edits: [] })"}`,
		path: undefined,
		fired: ["edit GLOSSARY"],
	},
	{ tool: "bash", argsJson: '{"command":"cat src/app.ts"}', path: undefined, fired: [] },
];

test.each(cases)("$tool $argsJson fires $fired", ({ tool, argsJson, path, fired }) => {
	expect(names(firedBy({ tool, argsJson, path }))).toEqual(fired);
});

test("three new delegates in one group fire the swarm event, spread over two groups they do not", () => {
	expect(names(firedByGroups(["audit", "audit", "audit"]))).toEqual(["group of 3+ delegates"]);
	expect(names(firedByGroups(["audit", "audit", "review"]))).toEqual([]);
});
