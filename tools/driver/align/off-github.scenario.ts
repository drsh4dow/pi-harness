import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { offGitHub, rootModel } from "./observe.ts";

scenario({
	env: { ...process.env, GH_HOST: offGitHub },
	model: rootModel,
	play: (run) =>
		Effect.gen(function* () {
			const { code, output } = yield* run.exec(["gh", "api", "user"]);

			yield* run.check(
				code !== 0 && Str.includes(offGitHub)(output),
				`with the human's gh login borrowed and GH_HOST set to ${offGitHub}, gh api user fails at that host and never reaches GitHub (it exited ${String(code)}: ${output})`,
			);
		}),
});
