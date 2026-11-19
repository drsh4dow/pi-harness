import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/observe.ts";
import { scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, firstStep, type Timeline } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "tallyclock: log time, print a report",
		files: {
			".gitignore": "__pycache__/\n",
			"README.md": `# tallyclock

Logs billable time per client and prints what to invoice.

    python -m tallyclock log acme 47      # 47 minutes for acme
    python -m tallyclock report           # hours per client

Entries live in \`~/.tallyclock.json\`.
`,
			"tallyclock/__init__.py": "",
			"tallyclock/billing.py": `import math


def billable_minutes(minutes: int) -> int:
    return math.ceil(minutes / 15) * 15


def hours(minutes: int) -> float:
    return billable_minutes(minutes) / 60
`,
			"tallyclock/__main__.py": `import json
import sys
from collections import defaultdict
from pathlib import Path

from .billing import hours

PATH = Path.home() / ".tallyclock.json"


def load() -> list[dict]:
    return json.loads(PATH.read_text()) if PATH.exists() else []


command, *rest = sys.argv[1:]
entries = load()
if command == "log":
    entries.append({"client": rest[0], "minutes": int(rest[1])})
    PATH.write_text(json.dumps(entries))
else:
    totals: dict[str, float] = defaultdict(float)
    for entry in entries:
        totals[entry["client"]] += hours(entry["minutes"])
    for client, total in sorted(totals.items()):
        print(f"{client:12} {total:6.2f} h")
`,
		},
	},
];

const request =
	"Clients keep querying our invoices because tallyclock rounds every entry up to the next 15 minutes. Change it to round each entry to the nearest 6 minutes, a tenth of an hour, and make sure `python -m tallyclock report` still adds up right.";

const handVerified = (timeline: Timeline) => {
	const ran = firstStep({
		timeline,
		matches: ({ tool, text }) =>
			(tool === "bash" || (tool === "codemode" && Str.includes("tools.bash")(text))) &&
			Str.includes("-m tallyclock")(text),
	});

	return Option.map(
		Option.filter(timeline.finalReply, () => Option.isSome(ran)),
		before,
	);
};

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		measure({
			run,
			guides: ["skills/create-verification-skill/SKILL.md"],
			history,
			request,
			within: "30 minutes",
			event: handVerified,
		}),
});
