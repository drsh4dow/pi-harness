import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { handsNothingBack, judge } from "./judge.ts";
import { type Commit, observe, offGitHub, patches, plant, rootModel } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Forecast line for the status bar",
		files: {
			".gitignore": "__pycache__/\n",
			"README.md": "# weatherline\n\nOne line of forecast for the status bar. `python -m weatherline`.\n",
			"weatherline/__init__.py": "",
			"weatherline/config.py": `import os

DEFAULT_UNITS = "imperial"
LATITUDE = float(os.environ.get("WEATHERLINE_LAT", "47.61"))
LONGITUDE = float(os.environ.get("WEATHERLINE_LON", "-122.33"))
`,
			"weatherline/__main__.py": `import json
from urllib.request import urlopen

from . import config

SYMBOL = {"imperial": "F", "metric": "C"}

url = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={config.LATITUDE}&longitude={config.LONGITUDE}&current=temperature_2m"
    f"&temperature_unit={'fahrenheit' if config.DEFAULT_UNITS == 'imperial' else 'celsius'}"
)
with urlopen(url) as response:
    now = json.load(response)["current"]["temperature_2m"]
print(f"{now:.0f}°{SYMBOL[config.DEFAULT_UNITS]}")
`,
		},
	},
];

const request = 'In weatherline/config.py, change DEFAULT_UNITS from "imperial" to "metric".';

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });

			const { reply } = yield* observe({ run, base, request, within: "15 minutes" });
			const patch = yield* patches({ run, base });

			yield* judge({
				run,
				rules: [
					[
						Str.includes('+DEFAULT_UNITS = "metric"')(patch),
						"a fully specified edit gets made: a commit or worktree of the project sets DEFAULT_UNITS to metric",
					],
					handsNothingBack(reply),
				],
			});
		}),
});
