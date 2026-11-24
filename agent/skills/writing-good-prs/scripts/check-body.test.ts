import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const whatChanged = `## What changed

- The parser keeps the last line.

`;

const scope = `## Scope

- Covers the parser only.

`;

const sizedScope = `## Scope\nsize: production +4 -1, tests +3 -0, docs +1 -0, other +0 -0 (base 9c1e2a0)\n\n`;

const prBody = (changed = whatChanged, tail = "", scoped = scope) => `## Why

The parser drops the last line of a file that has no trailing newline.

${changed}${scoped}## Verification

- \`bun test parser\` → 12 pass.
${tail}`;

const lines = (count: number, text: string) =>
  Array.from({ length: count }, (_, index) => `${text} ${index + 1}.\n`).join("");

const said = (bullet: string) => `## What changed\n\n- ${bullet}\n\n`;

const bugTemplate = `## What happens

Actual behavior.

## What should happen

Expected behavior.

## Steps to reproduce

1. 

## Impact

Who is affected and how many. Does it touch billing, claims, or patient data?

## Evidence

Datadog link, support ticket, screenshot.

## Acceptance criteria

- [ ] Fixed, and a regression test covers it

+++ Agent notes

Root cause, files, logs.

+++
`;

const taskTemplate = `## Why

One or two sentences: what this unlocks, tied to the project or milestone.

## What

The change, described as behavior someone can observe, not as implementation.

## Acceptance criteria

- [ ] Testable statement
- [ ] Testable statement

## Out of scope

What this issue deliberately doesn't do (each item becomes its own issue if needed).

+++ Agent notes

Implementation plan, files, commands, logs.

+++
`;

const impact = `## Impact

Every biller who pastes long notes, about 40 claims a week. It touches claims.

`;

const bugAgentNotes = `+++ Agent notes

The notes column is varchar(4000).

+++
`;

const bugBody = `## What happens

Saving a claim with a 5,000 character note returns a 500.

## What should happen

The claim saves and keeps the whole note.

## Steps to reproduce

1. Open a claim.
2. Paste a 5,000 character note and save.

${impact}## Evidence

Datadog trace: https://app.datadoghq.com/apm/trace/123

## Acceptance criteria

- [ ] Fixed, and a regression test covers it

${bugAgentNotes}`;

const taskAgentNotes = `+++ Agent notes

Add a cursor to the export query.

+++
`;

const notesForAgents = `# Notes for agents

Run the export against staging before review.
`;

const taskBody = (end: string) => `## Why

Finance needs exports over 10,000 rows for the quarter close.

## What

An export of any size downloads as one CSV.

## Acceptance criteria

- [ ] A 50,000 row export downloads whole

## Out of scope

Excel output.

${end}`;

const ui = (paths: string) => ({ "--changed-files": paths });

function check(kind: string, body: string, files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-body-test-"));

  try {
    writeFileSync(join(dir, "body.md"), body);

    const flags = Object.entries(files).flatMap(([flag, content], index) => {
      writeFileSync(join(dir, `${index}.txt`), content);
      return [flag, join(dir, `${index}.txt`)];
    });
    const run = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "check-body.ts"),
      kind,
      join(dir, "body.md"),
      ...flags,
    ]);

    return { exitCode: run.exitCode, printed: run.stdout.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.each([
  { name: "a PR of Why, What changed, and Verification", body: prBody() },
  { name: "a PR that drops every heading but Why, Scope, and Verification", body: prBody("") },
  { name: "a PR whose Scope holds only the size line publish-pr writes", body: prBody(whatChanged, "", sizedScope) },
  { name: "a PR that leaves Scope empty for publish-pr's size line", body: prBody(whatChanged, "", "## Scope\n\n") },
  {
    name: "a PR without Why",
    body: `${whatChanged}${scope}## Verification\n\n- \`bun test parser\` → 12 pass.\n`,
  },
  {
    name: "a PR with all six headings",
    body: prBody(
      whatChanged,
      "",
      `## Scope\n\n- Leaves out: files over 2 GB.\n\n## Tradeoffs\n\nA streaming parser would cost a rewrite of every caller.\n\n## Blast Radius\n\nCallers of the parser, which would see one extra line. A two-way door.\n\n`,
    ),
  },
  { name: "a PR of 39 lines", body: prBody(whatChanged, lines(24, "Output line")) },
  {
    name: "a PR of 39 lines plus the size line under Scope",
    body: prBody(whatChanged, lines(26, "Output line"), sizedScope),
  },
  {
    name: "a PR naming <details>, a long dash, and curly quotes inside inline code",
    body: prBody(said("Refuses `<details>`, `a \u2014 b`, and `\u201Cvalue\u201D`.")),
  },
  {
    name: "a PR with a long dash in a link destination",
    body: prBody(said("Follows [the style guide](https://example.com/dash\u2014guide).")),
  },
  {
    name: "a PR with literal words that unslop rule 7 lists",
    body: prBody(
      said("The PDF prints in landscape, and `snake_case` keeps its underscore. See [the run](https://example.com/enhanced)."),
    ),
  },
  {
    name: "a PR changing a .tsx file with a Before | After table",
    body: prBody(
      whatChanged,
      "\n| Before | After |\n| --- | --- |\n| ![before](https://example.com/b.png) | ![after](https://example.com/a.png) |\n",
    ),
    files: ui("src/App.tsx\n"),
  },
  {
    name: "a PR changing a .tsx file that names the missing screenshots",
    body: prBody(
      whatChanged,
      "\n**Not checked:** screenshots, because the dev server needs production keys.\n",
    ),
    files: ui("src/App.tsx\n"),
  },
  {
    name: "a PR changing only a .ts file without a table",
    body: prBody(),
    files: ui("src/server.ts\n"),
  },
  {
    name: "a ticket quoting a reporter with a curly apostrophe",
    kind: "ticket",
    body: bugBody.replace("returns a 500.", "returns a 500. A biller wrote: \u201Cit doesn\u2019t save\u201D."),
    files: { "--template": bugTemplate },
  },
  {
    name: "a ticket filling ENG: Bug",
    kind: "ticket",
    body: bugBody,
    files: { "--template": bugTemplate },
  },
  {
    name: "a ticket filling ENG: Task with a trailing # Notes for agents",
    kind: "ticket",
    body: taskBody(`${taskAgentNotes}\n${notesForAgents}`),
    files: { "--template": taskTemplate },
  },
])("passes $name", ({ kind = "pr", body, files }) => {
  expect(check(kind, body, files)).toEqual({ exitCode: 0, printed: "" });
});

test.each([
  {
    name: "a PR without Scope, which carries the size line",
    body: prBody(whatChanged, "", ""),
    finding: 'body.md:1: missing "## Scope"',
  },
  {
    name: "a PR with Scope after Verification",
    body: prBody(whatChanged, "\n## Scope\n\nCovers the parser only.\n"),
    finding: 'body.md:17: "## Scope" is out of order or repeated',
  },
  {
    name: "a PR with an Evidence section",
    body: prBody(whatChanged, "\n## Evidence\n\nThe parser log.\n"),
    finding: 'body.md:17: unexpected heading "## Evidence"',
  },
  {
    name: "a PR of 40 lines",
    body: prBody(whatChanged, lines(25, "Output line")),
    finding: "body.md:40: body has 40 lines, cut it to under 40",
  },
  {
    name: "a PR with <details>",
    body: prBody(whatChanged, "\n<details><summary>Log</summary>\n\nOutput.\n\n</details>\n"),
    finding: "body.md:17: a PR body has no <details>",
  },
  {
    name: "a PR with a long dash",
    body: prBody(said("The parser keeps the last line \u2014 always.")),
    finding: "body.md:7: long dash, use a period or a comma",
  },
  {
    name: "a PR with curly quotes",
    body: prBody(said("The parser keeps the \u201Clast\u201D line.")),
    finding: "body.md:7: curly quote, use a straight quote",
  },
  {
    name: "an empty PR body",
    body: "",
    finding: "body.md:1: body is empty",
  },
  {
    name: "a PR body of only a Scope heading and its size line",
    body: "## Scope\nsize: production +4 -1, tests +3 -0, docs +1 -0, other +0 -0 (base 9c1e2a0)\n",
    finding: "body.md:1: body is empty",
  },
  {
    name: "a PR with a heading that has nothing under it",
    body: prBody(whatChanged, "\n## Blast Radius\n"),
    finding: 'body.md:17: "## Blast Radius" is empty, drop it',
  },
  {
    name: "a PR that leaves out a heading its template has",
    body: "## Testing\n\n- `bun test parser`: 12 pass.\n",
    files: { "--template": "## Why\n\n## What changed\n\n## Testing\n" },
    finding: 'body.md:1: missing "## Why"',
  },
  {
    name: "a PR changing a .tsx file without a table",
    body: prBody(),
    files: ui("src/App.tsx\n"),
    finding: "body.md:1: the PR changes UI files (src/App.tsx) but has no",
  },
  {
    name: "an ENG: Bug ticket without Impact",
    kind: "ticket",
    body: bugBody.replace(impact, ""),
    files: { "--template": bugTemplate },
    finding: 'body.md:1: missing "## Impact"',
  },
  {
    name: "an ENG: Bug ticket without the Agent notes block",
    kind: "ticket",
    body: bugBody.replace(bugAgentNotes, ""),
    files: { "--template": bugTemplate },
    finding: 'body.md:1: missing "+++ Agent notes"',
  },
  {
    name: "an ENG: Task ticket with # Notes for agents before the Agent notes block",
    kind: "ticket",
    body: taskBody(`${notesForAgents}\n${taskAgentNotes}`),
    files: { "--template": taskTemplate },
    finding: '"+++ Agent notes" is out of order or repeated',
  },
  {
    name: "a ticket with # Notes for agents and no template",
    kind: "ticket",
    body: `## Problem\n\nExports over 10,000 rows fail.\n\n## Done when\n\n- [ ] A 50,000 row export downloads whole\n\n${notesForAgents}`,
    finding: 'body.md:9: unexpected heading "# Notes for agents"',
  },
])("fails $name", ({ kind = "pr", body, files, finding }) => {
  const { exitCode, printed } = check(kind, body, files);

  expect(printed).toContain(finding);
  expect(exitCode).toBe(1);
});
