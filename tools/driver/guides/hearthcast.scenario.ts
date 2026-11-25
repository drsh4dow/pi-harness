import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Str from "effect/String";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/index.ts";
import { scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, firstStep, type Timeline } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Static site for the hearthcast podcast",
		files: {
			".gitignore": "public/\n",
			"README.md": `# hearthcast

The website of the hearthcast podcast. \`build.py\` turns \`episodes.json\` into \`public/\`.

Deploying: I run this from my laptop after each episode.

    python build.py
    npx wrangler pages deploy public --project-name hearthcast
`,
			"episodes.json": `[
  {"number": 1, "title": "Lighting the fire", "date": "2026-10-02", "audio": "https://media.hearthcast.fm/001.mp3"},
  {"number": 2, "title": "Kindling", "date": "2026-10-16", "audio": "https://media.hearthcast.fm/002.mp3"}
]
`,
			"build.py": `import json
from html import escape
from pathlib import Path

episodes = json.loads(Path("episodes.json").read_text())
items = "\\n".join(
    f'<li><a href="{escape(e["audio"])}">#{e["number"]} {escape(e["title"])}</a> <time>{e["date"]}</time></li>'
    for e in sorted(episodes, key=lambda e: e["number"], reverse=True)
)
Path("public").mkdir(exist_ok=True)
Path("public/index.html").write_text(f"<!doctype html><title>hearthcast</title><h1>hearthcast</h1><ul>{items}</ul>\\n")
`,
		},
	},
];

const request =
	"Right now I deploy hearthcast by running wrangler from my laptop after every episode, and I forget half the time. Can you make it deploy itself from GitHub Actions on every push to main? The Cloudflare Pages project is already set up and called hearthcast.";

const secret = "CLOUDFLARE_API_TOKEN";

const byTime = Order.mapInput(Order.String, ({ at }: { readonly at: string }) => at);

const handBack = (timeline: Timeline) => {
	const item = firstStep({
		timeline,
		matches: ({ text }) => Str.includes("USER_ACTION_ITEMS.md")(text) && Str.includes(secret)(text),
	});

	const reply = Option.filter(timeline.finalReply, ({ text }) => Str.includes(secret)(text));

	const moments = Arr.sort(Arr.getSomes([item, reply]), byTime);

	return Option.map(Arr.head(moments), before);
};

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		measure({ run, guides: ["skills/wizard/SKILL.md"], history, request, within: "30 minutes", event: handBack }),
});
