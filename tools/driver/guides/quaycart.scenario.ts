import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Commit, offGitHub, rootModel } from "#tools/driver/align/index.ts";
import { type Run, scenario } from "#tools/driver/index.ts";
import { measure } from "./measure.ts";
import { before, firstStep, type Timeline, writesFile } from "./timeline.ts";

const history: ReadonlyArray<Commit> = [
	{
		subject: "Checkout page",
		files: {
			"README.md": "# quaycart\n\nThe storefront of our ferry-ticket shop. Open `checkout.html` in a browser.\n",
			"checkout.html": `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="checkout.css">
<main class="checkout">
  <h1>Your tickets</h1>
  <div class="row"><span>Harbour to Island, 2 adults</span><span>EUR 38.00</span></div>
  <div class="actions"><a href="/cart">Back to cart</a><button class="pay">Pay EUR 38.00 now</button></div>
</main>
`,
			"checkout.css": `.checkout { max-width: 40rem; margin: 0 auto; padding: 1rem; font-family: sans-serif; }
.row { display: flex; justify-content: space-between; }
.actions { display: flex; gap: 1rem; white-space: nowrap; }
.actions a { min-width: 12rem; }
.pay { min-width: 16rem; padding: 1rem 2rem; font-size: 1.2rem; }
`,
		},
	},
];

const screenshot = "checkout-overflow.png";

const request = `On a small phone the Pay button on quaycart's checkout page runs off the right edge of the screen. I grabbed a screenshot: ~/Pictures/${screenshot}. Please file a GitHub issue for it with the screenshot in the issue, so whoever picks it up sees what I saw. Just the issue for now, don't fix it.`;

const plantScreenshot = (run: Run) =>
	Effect.andThen(
		run.exec(["mkdir", "-p", `${run.home}/Pictures`]),
		run.exec([
			"magick",
			"-size",
			"390x844",
			"xc:white",
			"-fill",
			"#222",
			"-pointsize",
			"28",
			"-annotate",
			"+20+80",
			"Your tickets",
			"-fill",
			"#1a56db",
			"-draw",
			"rectangle 230,400 520,470",
			`${run.home}/Pictures/${screenshot}`,
		]),
	);

const filing = (timeline: Timeline) =>
	Option.map(
		firstStep({
			timeline,
			matches: (call) =>
				Str.includes("gh issue create")(call.argumentsJson) ||
				(writesFile(call) && Str.includes(screenshot)(call.argumentsJson)),
		}),
		before,
	);

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.andThen(
			plantScreenshot(run),
			measure({ run, guides: ["skills/dumpfile/SKILL.md"], history, request, within: "20 minutes", event: filing }),
		),
});
