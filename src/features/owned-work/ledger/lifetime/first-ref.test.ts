import { expect, test } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { piSessionsLayer } from "#src/client/pi/index.ts";
import { Hc, Slices, TerminalAddress } from "#src/client/terminals/index.ts";
import { Self } from "#src/features/owned-work/child.ts";
import { Host, Ledger, ledgerLayer } from "#src/features/owned-work/ledger/ledger.ts";
import { node } from "#src/features/owned-work/ledger/world.fixture.ts";
import { StartRequest, WorkRef } from "#src/features/owned-work/work.ts";

const outside = Layer.mergeAll(
	Layer.succeed(Hc, {
		run: () => Effect.succeed(TerminalAddress("t1")),
		open: () => Effect.succeed(TerminalAddress("t2")),
		labelsOf: () => Effect.succeed({}),
		follow: Effect.void,
		kill: () => Effect.void,
		label: () => Effect.void,
		waitForOutput: () => Effect.succeed(false),
		read: () => Effect.succeed(""),
		notices: Stream.never,
	}),
	Layer.succeed(Host, { wake: () => Effect.void, append: () => Effect.void }),
	Layer.succeed(Slices, { wrap: (spec) => spec, stop: () => Effect.void, stopAll: Effect.void }),
	piSessionsLayer,
);

test("a ledger's first work takes the first ref it is given, so refs go on past a resumed session's transcript", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const self = Self.Root({ role: "root", level: 1 });
			const ledger = ledgerLayer({ self, cwd: "/", passEnv: {}, firstRef: 8, handover: Option.none() });
			const context = yield* Layer.build(Layer.provide(ledger, outside));
			const serve = StartRequest.Serve({ name: "dev server", command: "true", ready: Option.none() });
			const handle = yield* Context.get(context, Ledger).start(serve);

			expect(handle.ref).toBe(WorkRef("serve-8"));
		}).pipe(Effect.scoped, Effect.provide(node)),
	));
