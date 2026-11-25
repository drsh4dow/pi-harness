import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { HerdrApp, HerdrAppError, herdrAppLayer } from "./index.ts";

const herdrAppWithNoWindow = Layer.effect(
	ChildProcessSpawner.ChildProcessSpawner,
	Effect.map(ChildProcessSpawner.ChildProcessSpawner, (real) =>
		ChildProcessSpawner.make(() =>
			real.spawn(ChildProcess.make("sh", ["-c", "echo 'no window is open' >&2; exit 1"])),
		),
	),
);

const noWindow = Layer.provide(herdrAppLayer, Layer.provide(herdrAppWithNoWindow, NodeServices.layer));

test("focus fails with the herdr-app error when no window is open", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const error = yield* Effect.flip(Effect.flatMap(HerdrApp, (herdrApp) => herdrApp.focus("t3")));

			expect(error).toEqual(HerdrAppError.make({ command: "agent.focus", message: "no window is open" }));
		}).pipe(Effect.provide(noWindow)),
	));
