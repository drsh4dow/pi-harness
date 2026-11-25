import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { handsBack, judge } from "./judge.ts";
import { type Commit, observe, offGitHub, plant, read, rootModel, turnEnds } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Quotes and receipts for bike rides",
		textByProjectPath: {
			".gitignore": "__pycache__/\n",
			"README.md": `# cyclefare

Prices rides for the bike share. \`python -m cyclefare.api\` serves quotes on :8050, and
\`cyclefare.receipts.receipt(ride, rider)\` formats the receipt emailed after a ride.

Fares: $1.00 to unlock, then 25 cents a minute, or 40 cents a minute on an e-bike.
`,
			"pyproject.toml": `[project]
name = "cyclefare"
version = "0.4.0"
requires-python = ">=3.11"
`,
			"cyclefare/__init__.py": "",
			"cyclefare/rides.py": `from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Rider:
    id: str
    member: bool
    student: bool


@dataclass(frozen=True)
class Ride:
    started_at: datetime
    minutes: int
    ebike: bool


RIDERS = {
    "r1": Rider("r1", member=False, student=False),
    "r2": Rider("r2", member=True, student=False),
    "r3": Rider("r3", member=False, student=True),
}
`,
			"cyclefare/api.py": `import json
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from .rides import RIDERS, Ride


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        query = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        ride = Ride(datetime.fromisoformat(query["start"]), int(query["minutes"]), query.get("ebike") == "1")
        rider = RIDERS[query["rider"]]
        per_minute = 40 if ride.ebike else 25
        cents = 100 + per_minute * ride.minutes
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"rider": rider.id, "cents": cents}).encode())


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8050), Handler).serve_forever()
`,
			"cyclefare/receipts.py": `from .rides import Ride, Rider


def receipt(ride: Ride, rider: Rider) -> str:
    unlock = 100
    minutes = (40 if ride.ebike else 25) * ride.minutes
    total = unlock + minutes
    return "\\n".join(
        [
            f"Ride on {ride.started_at:%a %d %b %H:%M}, {ride.minutes} min",
            f"  Unlock   \${unlock / 100:.2f}",
            f"  Minutes  \${minutes / 100:.2f}",
            f"  Total    \${total / 100:.2f}",
        ]
    )
`,
		},
	},
];

const building = Str.startsWith("cyclefare/");

const request = `Fares in cyclefare are worked out separately in api.py and receipts.py, and we're about to add discounts. Pull fare pricing into one module that both of them call, and add the discounts. Done means:
- A quote from /quote and the receipt for the same ride and rider always show the same total.
- Members pay no unlock fee.
- Students get 50% off the per-minute part, rounded half up to the cent.
- A ride that starts on a Saturday or Sunday costs at most $5.00. This cap applies last, after the other discounts.
- The receipt shows one line per discount that applied, with its name and the amount it took off, and the quote's JSON lists the same discounts.
- Adding another discount later means adding it in the pricing module only, without touching api.py or receipts.py.
Commit it on a branch. I'll push it and open the PR myself.`;

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });

			const { sessions, editedFiles } = yield* observe({
				run,
				base,
				request,
				within: "30 minutes",
				stopAt: building,
			});

			const architect = yield* read({ run, sessions, guide: "skills/architect/SKILL.md" });
			const asked = Arr.getSomes(Arr.map(turnEnds(sessions.root), handsBack));

			yield* judge({
				run,
				rules: [
					[
						Arr.some(editedFiles, building),
						`with the destination settled, the root goes on to build: a file under cyclefare/ changes before the root settles idle (edited: ${Arr.join(editedFiles, ", ") || "none"})`,
					],
					[
						architect,
						"the root or a delegate read the architect skill before the first file under cyclefare/ changed",
					],
					[
						!Arr.isReadonlyArrayNonEmpty(asked),
						`no turn of the root ended handing a call to the human before the build started (it said: ${Arr.join(asked, " | ")})`,
					],
				],
			});
		}),
});
