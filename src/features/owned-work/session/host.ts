import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { Host, Out } from "#src/features/owned-work/ledger/index.ts";
import { entryKind } from "#src/features/owned-work/recorded.ts";
import type { Settled } from "#src/features/owned-work/work.ts";

export interface Relay {
	waiter: Option.Option<Deferred.Deferred<ReadonlyArray<Settled>>>;
}

export const messageOf = (settled: Settled) => {
	const json = Out.result(settled);

	return Effect.map(Out.text(json), (content) => ({ customType: entryKind, content, display: true, details: json }));
};

export const hostLayer = ({
	pi,
	relay,
}: {
	readonly pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">;
	readonly relay: Relay;
}) => {
	const send = (settled: Settled) =>
		Effect.map(messageOf(settled), (message) => {
			pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true });
		});

	const handOver = (waiter: Deferred.Deferred<ReadonlyArray<Settled>>, results: ReadonlyArray<Settled>) => {
		relay.waiter = Option.none();

		return Effect.asVoid(Deferred.succeed(waiter, results));
	};

	return Layer.succeed(Host, {
		wake: (results) =>
			Option.match(relay.waiter, {
				onSome: (waiter) => handOver(waiter, results),
				onNone: () => Effect.asVoid(Effect.forEach(results, send)),
			}),
		append: (entry) =>
			Effect.sync(() => {
				pi.appendEntry(entryKind, Out.entry(entry));
			}),
	});
};
