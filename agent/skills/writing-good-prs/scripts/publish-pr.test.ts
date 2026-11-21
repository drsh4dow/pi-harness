import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const draft = `## Why

The parser drops the last line of a file that has no trailing newline.

## What changed

\`\`\`diff
- return lines.slice(0, -1);
+ return lines;
\`\`\`

## Scope

Covers the parser only.

## Blast Radius

Callers of the parser. A two-way door.

## Verification

- **The last line is read.** \`0 lines\` → \`1 line\`.

**Not checked:** nothing.
`;

const live = `${draft}
## Plan

A section a bot appended.
`;

const sizeFor = (range: string) =>
  `size: production +4 -1, tests +3 -0, docs +1 -0, other +0 -0 (base ${range})`;

const withSize = (body: string, range: string) =>
  body.replace("## Scope\n", `## Scope\n${sizeFor(range)}\n`);

const stale = withSize(draft, "0000000");

const fakeGh = (sent: string, files: string) => `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const [, , , verb, ...rest] = process.argv;
const json = rest[rest.indexOf("--json") + 1];
const sent = ${JSON.stringify(sent)};
if (json === "files") {
  process.stdout.write(${JSON.stringify(files)});
} else if (json === "defaultBranchRef") {
  console.log("main");
} else if (json === "baseRefName,headRefOid") {
  console.log("main 9c1e2a0");
} else if (verb === "view") {
  const body = existsSync(sent) ? readFileSync(sent, "utf8") : ${JSON.stringify(live)};
  console.log(JSON.stringify({ title: "fix(parser): read the last line", body }));
} else {
  writeFileSync(sent, readFileSync(rest[rest.indexOf("--body-file") + 1], "utf8"));
  console.log("https://github.com/example/repo/pull/7");
}
`;

const fakeGit = (files: string) => `#!/usr/bin/env node
if (process.argv[2] === "diff") process.stdout.write(${JSON.stringify(files)});
`;

const fakeDiffSize = {
  prints: `#!/bin/sh\necho "${sizeFor("$1 $2")}"\n`,
  fails: `#!/bin/sh\necho "diff-size: git merge-base origin/main 9c1e2a0 failed: fatal: Not a valid object name 9c1e2a0" >&2\nexit 2\n`,
};

const published = "publish-pr: published https://github.com/example/repo/pull/7\n";

test.each([
  {
    name: "create writes the size line of the branch under Scope",
    verb: ["create"],
    flags: [],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    exitCode: 0,
    sent: withSize(draft, "origin/main HEAD"),
    printed: published,
    warned: "",
  },
  {
    name: "edit replaces a stale size line with the PR's own",
    verb: ["edit", "7"],
    flags: ["--replace"],
    body: stale,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    exitCode: 0,
    sent: withSize(draft, "origin/main 9c1e2a0"),
    printed: published,
    warned: "",
  },
  {
    name: "edit publishes without the size line and warns once when diff-size fails",
    verb: ["edit", "7"],
    flags: ["--replace"],
    body: stale,
    diffSize: fakeDiffSize.fails,
    files: "src/parser.ts\n",
    exitCode: 0,
    sent: draft,
    printed: published,
    warned:
      "publish-pr: warning: publishing without the size line: diff-size: git merge-base origin/main 9c1e2a0 failed: fatal: Not a valid object name 9c1e2a0\n",
  },
  {
    name: "edit keeps the live sections the file lacks",
    verb: ["edit", "7"],
    flags: [],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    exitCode: 0,
    sent: withSize(live, "origin/main 9c1e2a0"),
    printed: `publish-pr: kept "## Plan" from the live body\n${published}`,
    warned: "",
  },
  {
    name: "edit sends nothing when a changed UI file has no Before | After table",
    verb: ["edit", "7"],
    flags: [],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\nweb/Button.tsx\n",
    exitCode: 1,
    sent: "nothing sent",
    printed: `<dir>/body.md:1: the PR changes UI files (web/Button.tsx) but has no "| Before | After |" table or "**Not checked:**" line naming the missing screenshots\n`,
    warned: "",
  },
])("$name", ({ verb, flags, body, diffSize, files, exitCode, sent, printed, warned }) => {
  const dir = mkdtempSync(join(tmpdir(), "publish-pr-test-"));

  try {
    for (const [name, script] of [
      ["gh", fakeGh(join(dir, "sent.md"), files)],
      ["git", fakeGit(files)],
      ["diff-size", diffSize],
    ]) {
      writeFileSync(join(dir, name), script);
      chmodSync(join(dir, name), 0o755);
    }

    writeFileSync(join(dir, "body.md"), body);

    const run = Bun.spawnSync(
      [
        process.execPath,
        join(import.meta.dir, "publish-pr.ts"),
        ...verb,
        join(dir, "body.md"),
        "--title",
        "fix(parser): read the last line",
        ...flags,
      ],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    );

    expect({
      exitCode: run.exitCode,
      printed: run.stdout.toString().replaceAll(dir, "<dir>"),
      warned: run.stderr.toString(),
      sent: existsSync(join(dir, "sent.md"))
        ? readFileSync(join(dir, "sent.md"), "utf8")
        : "nothing sent",
    }).toEqual({ exitCode, printed, warned, sent });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
