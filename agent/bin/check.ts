import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { checkCli } from "#src/features/checks/index.ts";

const exitWith = (code: number) =>
	Effect.sync(() => {
		process.exitCode = code;
	});

const program = Effect.flatMap(checkCli({ args: process.argv.slice(2), cwd: process.cwd() }), exitWith);

NodeRuntime.runMain(Effect.provide(program, NodeServices.layer));
