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

const oldFormat = live.replace(
  "\n## Plan",
  "\n## Risk\n\nNone.\n\n## Evidence\n\n<details><summary>Parser log</summary>\n\n1 line\n\n</details>\n\n## Plan",
);

const harnessSections = [
  "Why (old)",
  "What changed (old)",
  "Scope (old)",
  "Tradeoffs",
  "Blast Radius (old)",
  "Verification (head b7e6a48d)",
  "Evidence",
  "Risk",
  "Before and after",
];

const bot = "## Summary by CodeRabbit\n\nA bot's summary.\n";

const everyHarnessSection = `${draft}\n${harnessSections.map((heading) => `## ${heading}\n\nOld text.\n\n`).join("")}${bot}`;

const noScope = draft.replace("## Scope\n\nCovers the parser only.\n\n", "");

const sizeFor = (range: string) =>
  `size: production +4 -1, tests +3 -0, docs +1 -0, other +0 -0 (base ${range})`;

const withSize = (body: string, range: string) =>
  body.replace("## Scope\n", `## Scope\n${sizeFor(range)}\n`);

const stale = withSize(draft, "0000000");

const fakeGh = (sent: string, files: string, liveBody: string) => `#!/usr/bin/env node
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
  const body = existsSync(sent) ? readFileSync(sent, "utf8") : ${JSON.stringify(liveBody)};
  console.log(JSON.stringify({ title: "fix(parser): read the last line", body }));
} else {
  writeFileSync(sent, readFileSync(rest[rest.indexOf("--body-file") + 1], "utf8"));
  console.log("https://github.com/example/repo/pull/7");
}
`;

const fakeGit = (files: string) => `#!/usr/bin/env node
if (process.argv[2] === "fetch") require("node:fs").writeFileSync(\`\${__dirname}/fetched\`, "");
if (process.argv[2] === "diff") process.stdout.write(${JSON.stringify(files)});
`;

const fakeDiffSize = {
  prints: `#!/bin/sh\ntest -f "$(dirname "$0")/fetched" || { echo "diff-size: $1 was never fetched" >&2; exit 2; }\necho "${sizeFor("$1 $2")}"\n`,
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
    name: "edit drops the harness's own sections from an old live body and keeps a bot's",
    verb: ["edit", "7"],
    flags: [],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    liveBody: oldFormat,
    exitCode: 0,
    sent: withSize(live, "origin/main 9c1e2a0"),
    printed: `publish-pr: dropped "## Risk" from the live body\npublish-pr: dropped "## Evidence" from the live body\npublish-pr: kept "## Plan" from the live body\n${published}`,
    warned: "",
  },
  {
    name: "edit drops a live section under every heading the harness writes, suffixed or not",
    verb: ["edit", "7"],
    flags: [],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    liveBody: everyHarnessSection,
    exitCode: 0,
    sent: withSize(`${draft}\n${bot}`, "origin/main 9c1e2a0"),
    printed: `${harnessSections.map((heading) => `publish-pr: dropped "## ${heading}" from the live body\n`).join("")}publish-pr: kept "## Summary by CodeRabbit" from the live body\n${published}`,
    warned: "",
  },
  {
    name: "create writes the size line under a closed Scope heading",
    verb: ["create"],
    flags: [],
    body: draft.replace("## Scope\n", "## Scope ##\n"),
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    exitCode: 0,
    sent: draft.replace("## Scope\n", `## Scope ##\n${sizeFor("origin/main HEAD")}\n`),
    printed: published,
    warned: "",
  },
  {
    name: "create refuses --draft, since a PR opens ready",
    verb: ["create"],
    flags: ["--draft"],
    body: draft,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    exitCode: 64,
    sent: "nothing sent",
    printed: "",
    warned: expect.stringContaining("publish-pr: expected create <body-file>"),
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
    printed: expect.stringMatching(
      /\/composed-body\.md:1: the PR changes UI files \(web\/Button\.tsx\) but has no "\| Before \| After \|" table or "\*\*Not checked:\*\*" line naming the missing screenshots\n$/,
    ),
    warned: "",
  },
])("$name", ({ verb, flags, body, diffSize, files, liveBody = live, exitCode, sent, printed, warned }) => {
  expect(publishPr({ verb, flags, body, diffSize, files, liveBody })).toEqual({
    exitCode,
    printed,
    warned,
    sent,
  });
});

type Run = {
  verb: string[];
  flags: string[];
  body: string;
  diffSize: string;
  files: string;
  liveBody: string;
};

function publishPr({ verb, flags, body, diffSize, files, liveBody }: Run) {
  const dir = mkdtempSync(join(tmpdir(), "publish-pr-test-"));

  try {
    for (const [name, script] of [
      ["gh", fakeGh(join(dir, "sent.md"), files, liveBody)],
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

    return {
      exitCode: run.exitCode,
      printed: run.stdout.toString().replaceAll(dir, "<dir>"),
      warned: run.stderr.toString(),
      sent: existsSync(join(dir, "sent.md"))
        ? readFileSync(join(dir, "sent.md"), "utf8")
        : "nothing sent",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const authored = (count: number) => {
  const used = draft.trimEnd().split("\n").length;
  const extra = Array.from({ length: count - used }, (_, index) => `Output line ${index + 1}.\n`);

  return `${draft}${extra.join("")}`;
};

const createOf = (body: string) =>
  publishPr({
    verb: ["create"],
    flags: [],
    body,
    diffSize: fakeDiffSize.prints,
    files: "src/parser.ts\n",
    liveBody: live,
  });

test("create publishes 39 authored lines plus Scope's size line, and the body it sends passes check-body", () => {
  const published = createOf(authored(39));
  const dir = mkdtempSync(join(tmpdir(), "publish-pr-sent-"));

  try {
    writeFileSync(join(dir, "sent.md"), published.sent);

    const check = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "check-body.ts"),
      "pr",
      join(dir, "sent.md"),
    ]);

    expect({ exitCode: published.exitCode, sentChecks: check.exitCode, sentSize: published.sent.includes("## Scope\nsize:") }).toEqual({
      exitCode: 0,
      sentChecks: 0,
      sentSize: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create refuses a 40-line authored body and sends nothing", () => {
  const refused = createOf(authored(40));

  expect({ exitCode: refused.exitCode, sent: refused.sent }).toEqual({ exitCode: 1, sent: "nothing sent" });
  expect(refused.printed).toContain("body has 40 lines, cut it to under 40");
});

test("create refuses a body without Scope, which carries the size line, and sends nothing", () => {
  const refused = createOf(noScope);

  expect({ exitCode: refused.exitCode, sent: refused.sent }).toEqual({ exitCode: 1, sent: "nothing sent" });
  expect(refused.printed).toContain('missing "## Scope"');
  expect(refused.warned).toBe("");
});

test("create checks the body it sends, so an empty Scope that the size line fills publishes", () => {
  const body = draft.replace("## Scope\n\nCovers the parser only.\n", "## Scope\n");
  const published = createOf(body);

  expect({ exitCode: published.exitCode, sent: published.sent }).toEqual({
    exitCode: 0,
    sent: body.replace("## Scope\n", `## Scope\n${sizeFor("origin/main HEAD")}\n`),
  });
});

test("create writes the size line under the real Scope, not a fenced example of one", () => {
  const body = draft.replace("## Scope\n", "```md\n## Scope\n```\n\n## Scope\n");
  const published = createOf(body);

  expect({ exitCode: published.exitCode, sent: published.sent }).toEqual({
    exitCode: 0,
    sent: body.replace("```\n\n## Scope\n", `\`\`\`\n\n## Scope\n${sizeFor("origin/main HEAD")}\n`),
  });
});
