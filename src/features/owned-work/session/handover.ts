import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionContext, SessionShutdownEvent, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { PiCli } from "#src/client/pi/index.ts";
import { SourceStamp } from "#src/client/source-stamp/index.ts";
import { ownCgroup, Slices, stopRoot } from "#src/client/terminals/index.ts";
import { Ledger } from "#src/features/owned-work/ledger/index.ts";
import type { LedgerState } from "#src/features/owned-work/step.ts";

export interface Lineage {
	readonly agentKey: string;
	readonly stamp: number;
}

export interface Handover extends Lineage {
	readonly state: LedgerState;
}

declare global {
	var piOwnedWorkHandover: Handover | undefined;
}

export const ledgerStamp = Effect.flatMap(SourceStamp, (stamp) =>
	stamp.of([`${import.meta.dirname}/../work.ts`, `${import.meta.dirname}/../step.ts`]),
);

export const take = (): Option.Option<Handover> => {
	const found = Option.fromUndefinedOr(globalThis.piOwnedWorkHandover);

	globalThis.piOwnedWorkHandover = undefined;

	return found;
};

export type Inheritance = Data.TaggedEnum<{
	Fresh: { readonly agentKey: string };
	Carried: { readonly agentKey: string; readonly state: LedgerState };
	Stale: { readonly agentKey: string; readonly stale: string };
}>;

export const Inheritance = Data.taggedEnum<Inheritance>();

export const newAgentKey = (): string => Str.takeRight(uuidv7(), 8);

const ownedScope = /\/(?<unit>pi-ow-[^/\n]+)\.scope$/mu;

export const rootSliceOf =
	(cgroup: string) =>
	(agentKey: string): string =>
		Option.match(Option.fromNullishOr(ownedScope.exec(cgroup)?.groups?.["unit"]), {
			onNone: () => `pi-ow-${agentKey}`,
			onSome: (unit) => `${unit}-${agentKey}`,
		});

export const rootSlices = Effect.map(ownCgroup, rootSliceOf);

export const inheritanceOf =
	({ stamp, agentKey }: Lineage) =>
	(reason: SessionStartEvent["reason"], handover: Option.Option<Handover>): Inheritance =>
		Option.match(
			Option.filter(handover, () => reason === "reload"),
			{
				onNone: () => Inheritance.Fresh({ agentKey }),
				onSome: (handed) =>
					handed.stamp === stamp
						? Inheritance.Carried({ agentKey: handed.agentKey, state: handed.state })
						: Inheritance.Stale({ agentKey, stale: handed.agentKey }),
			},
		);

export const stateOf = (inheritance: Inheritance): Option.Option<LedgerState> =>
	Inheritance.$is("Carried")(inheritance) ? Option.some(inheritance.state) : Option.none();

export const stopStale =
	({
		ui,
		sliceOf,
	}: {
		readonly ui: Pick<ExtensionContext["ui"], "notify">;
		readonly sliceOf: (agentKey: string) => string;
	}) =>
	(inheritance: Inheritance) =>
		Inheritance.$is("Stale")(inheritance)
			? Effect.andThen(
					stopRoot(sliceOf(inheritance.stale)),
					Effect.sync(() => {
						ui.notify(
							"This reload changed owned-work's ledger, so the work the last load started was stopped.",
							"warning",
						);
					}),
				)
			: Effect.void;

const handOver = (lineage: Lineage) =>
	Effect.gen(function* () {
		const state = yield* Effect.flatMap(Ledger, (ledger) => ledger.freeze);

		yield* Effect.flatMap(PiCli, (cli) => cli.release);
		globalThis.piOwnedWorkHandover = { ...lineage, state };
	});

export const leave =
	(lineage: Lineage) =>
	({ reason }: SessionShutdownEvent) =>
		reason === "reload" ? handOver(lineage) : Effect.flatMap(Slices, (slices) => slices.stopAll);
