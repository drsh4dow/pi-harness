import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/index.ts";
import { scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, type Call, firstStep, type Timeline, writesFile } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Tide times page",
		textByProjectPath: {
			"README.md":
				"# harborview\n\nTide times for our harbour. Open `index.html`; `tides.js` holds the week ahead.\n",
			"index.html": `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>harborview</title>
<h1>Tides this week</h1>
<pre id="tides"></pre>
<script src="tides.js"></script>
<script>
  document.getElementById("tides").textContent = week
    .map((day) => day.date + "  " + day.tides.map((t) => t.time + " " + t.kind + " " + t.metres + "m").join("  "))
    .join("\\n");
</script>
`,
			"tides.js": `const week = [
  { date: "Mon 23", tides: [{ time: "03:12", kind: "high", metres: 4.1 }, { time: "09:31", kind: "low", metres: 0.9 }, { time: "15:40", kind: "high", metres: 4.3 }, { time: "21:58", kind: "low", metres: 0.7 }] },
  { date: "Tue 24", tides: [{ time: "04:01", kind: "high", metres: 4.3 }, { time: "10:19", kind: "low", metres: 0.7 }, { time: "16:27", kind: "high", metres: 4.5 }, { time: "22:44", kind: "low", metres: 0.5 }] },
  { date: "Wed 25", tides: [{ time: "04:47", kind: "high", metres: 4.5 }, { time: "11:04", kind: "low", metres: 0.5 }, { time: "17:12", kind: "high", metres: 4.6 }, { time: "23:28", kind: "low", metres: 0.4 }] },
  { date: "Thu 26", tides: [{ time: "05:31", kind: "high", metres: 4.6 }, { time: "11:47", kind: "low", metres: 0.4 }, { time: "17:55", kind: "high", metres: 4.6 }] },
  { date: "Fri 27", tides: [{ time: "00:10", kind: "low", metres: 0.4 }, { time: "06:14", kind: "high", metres: 4.5 }, { time: "12:29", kind: "low", metres: 0.5 }, { time: "18:37", kind: "high", metres: 4.4 }] },
  { date: "Sat 28", tides: [{ time: "00:52", kind: "low", metres: 0.6 }, { time: "06:57", kind: "high", metres: 4.3 }, { time: "13:11", kind: "low", metres: 0.7 }, { time: "19:20", kind: "high", metres: 4.1 }] },
  { date: "Sun 29", tides: [{ time: "01:35", kind: "low", metres: 0.9 }, { time: "07:41", kind: "high", metres: 4.0 }, { time: "13:55", kind: "low", metres: 1.0 }, { time: "20:05", kind: "high", metres: 3.8 }] },
];
`,
		},
	},
];

const request =
	"harborview's tide page is a wall of numbers. For the week ahead I keep going back and forth between a compact table and a small line chart per day, and I can't decide. Go with whichever actually reads better on a phone, and build that.";

const writesCode = (call: Call) =>
	writesFile(call) &&
	!Str.includes("/.local/state/")(call.argumentsJson) &&
	!Option.exists(call.path, Str.endsWith(".md"));

const firstCode = (timeline: Timeline) => Option.map(firstStep({ timeline, matches: writesCode }), before);

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		measure({
			run,
			guides: ["playbooks/prototype.md", "skills/prototyping/SKILL.md"],
			history,
			request,
			within: "25 minutes",
			event: firstCode,
		}),
});
