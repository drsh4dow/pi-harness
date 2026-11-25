import { expect, test } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { piHost } from "#src/client/pi/index.ts";
import { Host, Out } from "#src/features/owned-work/ledger/index.ts";
import { entryKind } from "#src/features/owned-work/recorded.ts";
import { Outcome, type Settled, WorkEntry, WorkRef } from "#src/features/owned-work/work.ts";
import { hostLayer, messageOf, type Relay } from "./host.ts";

const settled: Settled = {
	ref: WorkRef("watch-1"),
	who: { kind: "watch", name: "nap", command: "sleep 15" },
	outcome: Outcome.Fired({ exitCode: 0, tail: "napped" }),
	log: Option.some("nap.log"),
};

const hostOn = (relay: Relay) => {
	const sent: Array<{ readonly message: unknown; readonly options: unknown }> = [];
	const appended: Array<{ readonly customType: string; readonly data: unknown }> = [];

	const pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry"> = {
		sendMessage: (message, options) => {
			sent.push({ message, options });
		},
		appendEntry: (customType, data) => {
			appended.push({ customType, data });
		},
	};

	const host = piHost(hostLayer({ pi, relay }));

	return {
		sent,
		appended,
		run: <Reply>(use: (service: (typeof Host)["Service"]) => Effect.Effect<Reply>) =>
			Effect.promise(() => host.run(Effect.flatMap(Host, use))),
	};
};

test("with no turn waiting, each result goes out as a wake, a follow-up message that starts a turn", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { sent, run } = hostOn({ waiter: Option.none() });
			const wake = yield* messageOf(settled);

			yield* run((host) => host.wake([settled]));

			expect(sent).toEqual([{ message: wake, options: { deliverAs: "followUp", triggerTurn: true } }]);
		}),
	));

test("a turn waiting on results takes them, no wake goes out, and the next results wake the agent", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const waiter = yield* Deferred.make<ReadonlyArray<Settled>>();
			const { sent, run } = hostOn({ waiter: Option.some(waiter) });

			yield* run((host) => host.wake([settled]));

			const taken = yield* Deferred.await(waiter);
			const sentWhileWaiting = sent.length;

			yield* run((host) => host.wake([settled]));

			expect({ taken, sentWhileWaiting, sentAfter: sent.length }).toEqual({
				taken: [settled],
				sentWhileWaiting: 0,
				sentAfter: 1,
			});
		}),
	));

test("an entry goes into the session as an owned-work entry", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { appended, run } = hostOn({ waiter: Option.none() });

			const entry = WorkEntry.CommandStarted({
				handle: WorkRef("watch-1"),
				kind: "watch",
				name: "nap",
				command: "sleep 15",
			});

			yield* run((host) => host.append(entry));

			expect(appended).toEqual([{ customType: entryKind, data: Out.entry(entry) }]);
		}),
	));
