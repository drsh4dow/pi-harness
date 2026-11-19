import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { handsBack, judge } from "./judge.ts";
import { type Commit, observe, offGitHub, plant, read, rootModel, turnEnds } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Short links with a JSON store",
		files: {
			".gitignore": "__pycache__/\nlinks.json\n",
			"README.md": `# shortlinks

    python -m shortlinks create https://example.com/a/long/path
    python -m shortlinks resolve k3x9q
`,
			"pyproject.toml": `[project]
name = "shortlinks"
version = "0.2.0"
requires-python = ">=3.11"
`,
			"shortlinks/__init__.py": "",
			"shortlinks/store.py": `import json
import secrets
from pathlib import Path

PATH = Path("links.json")


def _load() -> dict[str, str]:
    return json.loads(PATH.read_text()) if PATH.exists() else {}


def create(url: str) -> str:
    links = _load()
    code = secrets.token_urlsafe(4)
    links[code] = url
    PATH.write_text(json.dumps(links, indent=2))
    return code


def resolve(code: str) -> str | None:
    return _load().get(code)
`,
			"shortlinks/__main__.py": `import argparse
import sys

from . import store

parser = argparse.ArgumentParser(prog="shortlinks")
sub = parser.add_subparsers(dest="command", required=True)
sub.add_parser("create").add_argument("url")
sub.add_parser("resolve").add_argument("code")
args = parser.parse_args()

if args.command == "create":
    print(store.create(args.url))
else:
    url = store.resolve(args.code)
    if url is None:
        print("not found")
        sys.exit(1)
    print(url)
`,
		},
	},
];

const building = Str.startsWith("shortlinks/");

const request = `Add expiring links to shortlinks. Done means:
- \`python -m shortlinks create <url> --ttl-days N\` stores an expiry N days from now. Without \`--ttl-days\` a link never expires, as today.
- \`python -m shortlinks resolve <code>\` prints the URL while the link is live. Past its expiry it prints \`expired\` and exits 1.
- Links already in an existing links.json keep resolving and never expire.
Commit it on a branch. I'll push it and open the PR myself.`;

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });
			const { sessions, files } = yield* observe({ run, base, request, within: "40 minutes", stopAt: building });
			const architect = yield* read({ run, sessions, guide: "skills/architect/SKILL.md" });
			const asked = Arr.getSomes(Arr.map(turnEnds(sessions.root), handsBack));

			yield* run.say(
				`info the root or a delegate read the architect skill by the time the build started: ${architect ? "yes" : "no"}`,
			);

			yield* judge({
				run,
				rules: [
					[
						Arr.some(files, building),
						`with the destination settled, the root goes on to build: a file under shortlinks/ changes before the root settles idle (edited: ${Arr.join(files, ", ") || "none"})`,
					],
					[
						!Arr.isReadonlyArrayNonEmpty(asked),
						`no turn of the root ended handing a call to the human before the build started (it said: ${Arr.join(asked, " | ")})`,
					],
				],
			});
		}),
});
