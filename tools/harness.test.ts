import { expect, test } from "bun:test";

import { harnessEntries } from "./harness.ts";

const gitignore = `/agent/*
!/agent/extensions/
!/agent/SYSTEM.md
!/agent/skills/web/
agent/sessions
!/docs/
# !/agent/old/
`;

test("harnessEntries lists each agent entry a .gitignore line un-ignores, folders and files alike, and nothing else", () => {
	expect(harnessEntries(gitignore)).toEqual(["extensions", "SYSTEM.md"]);
});
