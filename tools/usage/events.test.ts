import { expect, test } from "bun:test";

import * as Arr from "effect/Array";

import { firedBy, firedByGroups } from "./events.ts";

const names = (events: ReadonlyArray<{ readonly name: string }>) => Arr.map(events, ({ name }) => name);

const cases = [
	{
		tool: "bash",
		args: String.raw`{"command":"git -C /repo commit -m \"x\""}`,
		path: undefined,
		fired: ["git commit"],
	},
	{ tool: "read", args: '{"path":"notes/git commit.md"}', path: "notes/git commit.md", fired: [] },
	{
		tool: "bash",
		args: String.raw`{"command":"gh pr create --body \"![demo](https://x.test/demo.gif)\""}`,
		path: undefined,
		fired: ["create a PR", "media reference"],
	},
	{
		tool: "bash",
		args: '{"command":"bun /home/u/.pi/agent/skills/writing-good-prs/scripts/publish-pr.ts create /tmp/body.md --title x"}',
		path: undefined,
		fired: ["create a PR"],
	},
	{ tool: "bash", args: '{"command":"gh issue create --title t"}', path: undefined, fired: ["create a ticket"] },
	{ tool: "edit", args: "{}", path: "src/app.ts", fired: ["edit .ts"] },
	{ tool: "write", args: "{}", path: "db/migrations/0001_init.sql", fired: ["edit a migration or schema"] },
	{ tool: "write", args: "{}", path: "docs/adr/0003-routing.md", fired: ["edit an ADR"] },
	{ tool: "write", args: "{}", path: "/state/USER_ACTION_ITEMS.md", fired: ["write USER_ACTION_ITEMS"] },
	{
		tool: "codemode",
		args: String.raw`{"code":"await tools.edit({ \"path\": \"/repo/GLOSSARY.md\", edits: [] })"}`,
		path: undefined,
		fired: ["edit GLOSSARY"],
	},
	{ tool: "bash", args: '{"command":"cat src/app.ts"}', path: undefined, fired: [] },
];

test.each(cases)("$tool $args fires $fired", ({ tool, args, path, fired }) => {
	expect(names(firedBy({ tool, args, path }))).toEqual(fired);
});

test("three new delegates in one group fire the swarm event, spread over two groups they do not", () => {
	expect(names(firedByGroups(["audit", "audit", "audit"]))).toEqual(["group of 3+ delegates"]);
	expect(names(firedByGroups(["audit", "audit", "review"]))).toEqual([]);
});
