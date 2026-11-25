import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { scenario } from "./index.ts";

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	contextWindow: 40_000,
	play: (run) =>
		Effect.gen(function* () {
			yield* run.root.prompt("Reply with the single word ok.");

			const loaded = yield* run.waitFor("what the root loaded", "30 seconds", ({ root }) => root.loaded);
			const foreign = Arr.filter(loaded.extensions, (file) => !Str.startsWith(`${run.agentDir}/extensions/`)(file));

			yield* run.say(`root runs pi ${loaded.version} on ${run.agentDir}`);
			yield* run.check(loaded.version === "1.5.2", `the root runs pi 1.5.2 (it runs ${loaded.version})`);
			yield* run.check(Arr.isReadonlyArrayNonEmpty(loaded.extensions), "the root loaded extensions");
			yield* run.check(
				foreign.length === 0,
				`every extension the root loaded comes from ${run.agentDir}/extensions (others: ${Arr.join(foreign, ", ")})`,
			);
		}),
});
