import * as Effect from "effect/Effect";

import { scenario } from "#tools/driver/index.ts";
import { terminalNameOf } from "./index.ts";

const texts = [
	"Review the retry cap, again!",
	"bun test --watch",
	"./scripts/check.sh",
	"audit attack-the-premise principle file",
	"supercalifragilisticexpialidocious-extra",
	"t7",
	"_private",
	"!!!",
];

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) =>
		Effect.forEach(texts, (text) =>
			Effect.flatMap(
				run.exec(["hc", "run", "--name", terminalNameOf(text), "--no-parent", "--bg", "true"]),
				({ code, output }) =>
					run.check(
						code === 0,
						`hc runs a terminal named ${terminalNameOf(text)}, from "${text}" (it said ${output})`,
					),
			),
		),
});
