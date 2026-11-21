import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { diffSize } from "#src/features/diff-size/index.ts";

const reportFailure = (message: string) =>
	Effect.andThen(
		Console.error(message),
		Effect.sync(() => {
			process.exitCode = 2;
		}),
	);

const [base = "origin/HEAD", head = "HEAD", ...extra] = process.argv.slice(2);

const program = Arr.isReadonlyArrayEmpty(extra)
	? diffSize(base, head).pipe(
			Effect.flatMap(Console.log),
			Effect.catchTag("GhError", ({ args, why }) =>
				reportFailure(`diff-size: ${Arr.join(args, " ")} failed: ${Arr.headNonEmpty(Str.split(why, "\n"))}`),
			),
		)
	: reportFailure("usage: diff-size [<base> [<head>]]");

NodeRuntime.runMain(Effect.provide(program, NodeServices.layer));
