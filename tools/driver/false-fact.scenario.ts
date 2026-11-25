import { scenario } from "./index.ts";

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) => run.check(run.pi.version === "0.0.0", `pi runs version 0.0.0 (it runs ${run.pi.version})`),
});
