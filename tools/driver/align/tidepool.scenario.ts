import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { scenario } from "#tools/driver/index.ts";
import { handsNothingBack, judge } from "./judge.ts";
import { type Commit, observe, offGitHub, plant, rootModel } from "./observe.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Tide predictions for one station",
		files: {
			".gitignore": "__pycache__/\n",
			"README.md": "# tidepool\n\nTide times for the spots we surf. `python -m tidepool <station>`.\n",
			"tidepool/__init__.py": "",
			"tidepool/stations.py": `STATIONS = {
    "santa-cruz": "9413745",
}
`,
			"tidepool/noaa.py": `import json
from urllib.request import urlopen

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def predictions(station: str, day: str) -> list[dict]:
    url = f"{API}?product=predictions&station={station}&begin_date={day}&range=24&datum=MLLW&units=english&time_zone=gmt&format=json&interval=hilo"
    with urlopen(url) as response:
        return json.load(response)["predictions"]
`,
		},
	},
	{
		subject: "Cache tide predictions on disk for a day",
		files: {
			"tidepool/cache.py": `import json
import time
from pathlib import Path

DIR = Path.home() / ".cache" / "tidepool"
DAY = 24 * 60 * 60


def cached(key: str, fetch):
    path = DIR / f"{key}.json"
    if path.exists() and time.time() - path.stat().st_mtime < DAY:
        return json.loads(path.read_text())
    value = fetch()
    DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))
    return value
`,
		},
	},
	{
		subject: "Show high tide times in local time instead of GMT",
		files: {
			"tidepool/times.py": `from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")


def local(gmt: str) -> str:
    moment = datetime.strptime(gmt, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    return moment.astimezone(PACIFIC).strftime("%a %H:%M")
`,
		},
	},
	{
		subject: "Add Monterey station",
		files: {
			"tidepool/stations.py": `STATIONS = {
    "santa-cruz": "9413745",
    "monterey": "9413450",
}
`,
		},
	},
];

const request =
	"Write up my standup update from what I did in tidepool the last couple of days. A few bullets is fine.";

const work = [/cach/iu, /local time|time ?zone|gmt/iu, /monterey/iu];

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const base = yield* plant({ run, history });
			const { reply } = yield* observe({ run, base, request, within: "15 minutes" });
			const named = Arr.filter(work, (piece) => Option.exists(reply, (text) => piece.test(text)));

			yield* judge({
				run,
				rules: [
					[
						named.length >= 2,
						`a report request gets the report: the root's settled reply names at least 2 of the caching, local time and Monterey work (it names ${String(named.length)})`,
					],
					handsNothingBack(reply),
				],
			});
		}),
});
