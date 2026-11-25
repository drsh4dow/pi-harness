import { expect, test } from "bun:test";

import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { callerOf, continued, delegate, runtime, started } from "./brief.fixture.ts";
import { modelNameOf, modelOf, modelTable } from "./models.ts";

const opus = getBuiltinModel("anthropic", "claude-opus-5-5");

const on = (provider: string, id: string): Model<Api> => ({ ...opus, provider, id });

const fable = "claude-fable-5-2";

const registry = [
	on("ultra-a", opus.id),
	on("ultra-b", opus.id),
	on("ent", opus.id),
	on("ultra-a", fable),
	on("ultra-b", fable),
	on("phi", "auto"),
	on("phi", "sealed"),
	on("phi", opus.id),
	on("phi", fable),
	on("openai", "gpt-6.1-sol"),
	on("openai", "gpt-6-luna"),
	on("opencode-go", "glm-5.3-flash"),
	on("elsewhere", opus.id),
];

type Runs = string | { readonly model: string; readonly substituted: string };

interface Row {
	readonly from: string;
	readonly parent: Model<Api>;
	readonly name: string;
	readonly runs: Runs;
}

const delegateModel = ({ parent, name }: Row) => {
	const caller = { model: parent, cwd: "/", modelRegistry: callerOf(() => registry).modelRegistry };

	return runtime.runPromise(
		modelOf(caller, modelTable, modelNameOf(name)).pipe(
			Effect.match({
				onFailure: (): Runs => "refused",
				onSuccess: ({ model, substitution }): Runs =>
					Option.match(substitution, {
						onNone: () => model,
						onSome: (substituted) => ({ model, substituted }),
					}),
			}),
		),
	);
};

const phiAuto = on("phi", "auto");

const onEnt = on("ent", opus.id);

const onOpenai = on("openai", "gpt-6.1-sol");

const onSealedParent = on("phi", "sealed");

const onSealed = (named: string) => ({
	model: "phi/sealed",
	substituted: `${named}, which neither phi-router nor a BAA provider carries, so this delegate runs on phi/sealed.`,
});

const divergent = onSealed("The alias `divergent` names opencode-go/glm-5.3-flash");

const heldOnSealed = (named: string) => ({
	model: "phi/sealed",
	substituted: `${named}, which no BAA provider carries, so this delegate runs on phi/sealed.`,
});

const routingRows = (from: string, parent: Model<Api>): ReadonlyArray<Row> => [
	{ from, parent, name: "judgment", runs: "phi/claude-opus-5-5" },
	{ from, parent, name: "worker", runs: "phi/claude-opus-5-5" },
	{ from, parent, name: "fable", runs: "phi/claude-fable-5-2" },
	{ from, parent, name: "ultra-b/claude-fable-5-2", runs: "phi/claude-fable-5-2" },
	{ from, parent, name: "elsewhere/claude-opus-5-5", runs: "phi/claude-opus-5-5" },
	{ from, parent, name: "investigator", runs: "openai/gpt-6.1-sol" },
	{ from, parent, name: "openai/gpt-6.1-sol", runs: "openai/gpt-6.1-sol" },
	{ from, parent, name: "divergent", runs: divergent },
	{ from, parent, name: "phi/auto", runs: "phi/auto" },
	{ from, parent, name: "ent/claude-opus-5-5", runs: "ent/claude-opus-5-5" },
];

const heldRows = (from: string, parent: Model<Api>): ReadonlyArray<Row> =>
	Arr.map(
		[
			{ name: "judgment", runs: "ent/claude-opus-5-5" },
			{ name: "ultra-b/claude-opus-5-5", runs: "ent/claude-opus-5-5" },
			{ name: "phi/claude-opus-5-5", runs: "ent/claude-opus-5-5" },
			{ name: "fable", runs: heldOnSealed("The alias `fable` names ultra-a/claude-fable-5-2") },
			{ name: "phi/claude-fable-5-2", runs: heldOnSealed("The model `phi/claude-fable-5-2`") },
			{ name: "phi/auto", runs: heldOnSealed("The model `phi/auto`") },
			{ name: "phi/sealed", runs: "phi/sealed" },
			{ name: "investigator", runs: "openai/gpt-6.1-sol" },
			{ name: "ent/claude-opus-5-5", runs: "ent/claude-opus-5-5" },
			{
				name: "divergent",
				runs: heldOnSealed("The alias `divergent` names opencode-go/glm-5.3-flash"),
			},
			{
				name: "opencode-go/glm-5.3-flash",
				runs: heldOnSealed("The model `opencode-go/glm-5.3-flash`"),
			},
		],
		(row) => ({ from, parent, ...row }),
	);

const openRows: ReadonlyArray<Row> = [
	{ from: "an ultra-a parent", parent: on("ultra-a", opus.id), name: "investigator", runs: "openai/gpt-6.1-sol" },
	{ from: "an ultra-a parent", parent: on("ultra-a", opus.id), name: "fable", runs: "ultra-a/claude-fable-5-2" },
	{ from: "an ultra-a parent", parent: on("ultra-a", opus.id), name: "divergent", runs: "opencode-go/glm-5.3-flash" },
	{
		from: "an ultra-a parent",
		parent: on("ultra-a", opus.id),
		name: "phi/claude-opus-5-5",
		runs: "phi/claude-opus-5-5",
	},
];

const rows: ReadonlyArray<Row> = [
	...routingRows("a routing phi/auto parent", phiAuto),
	...routingRows("a routing phi/claude-fable-5-2 parent", on("phi", fable)),
	...heldRows("a phi/sealed parent", onSealedParent),
	...heldRows("an ent parent", onEnt),
	...heldRows("an openai parent", onOpenai),
	...openRows,
];

test.each(rows)("a delegate of $from that names $name runs on $runs", (row) =>
	Effect.runPromise(
		Effect.map(
			Effect.promise(() => delegateModel(row)),
			(model) => {
				expect(model).toEqual(row.runs);
			},
		),
	),
);

type DelegateCall = Parameters<typeof delegate.execute>[1];

const calledFrom = (parent: Model<Api>, call: DelegateCall) => {
	const caller = { ...callerOf(() => registry), model: parent };

	return Effect.map(
		Effect.promise(() => delegate.execute("call", call, undefined, undefined, caller)),
		({ isError, details }) => {
			continued.splice(0);

			return { isError, details, started: Arr.map(started.splice(0), ({ brief }) => brief.model) };
		},
	);
};

const handedTo = "call wait, or end your turn and delegate-1 wakes you";

const relaunched = (model: string) => ({
	isError: false,
	details: { ref: "delegate-1", kind: "delegate", next: handedTo },
	started: [model],
});

const substitutedOn = (model: string, substituted: string) => ({
	isError: false,
	details: { ref: "delegate-1", kind: "delegate", next: handedTo, substituted },
	started: [model],
});

const fresh = (model: string): DelegateCall => ({
	goal: "Cap the retries.",
	name: "scout",
	message: "Read it.",
	role: "leaf",
	model,
});

interface CallRow {
	readonly title: string;
	readonly parent: Model<Api>;
	readonly call: DelegateCall;
	readonly expect: ReturnType<typeof relaunched | typeof substitutedOn>;
}

const calls: ReadonlyArray<CallRow> = [
	{
		title: "naming deep from a phi/sealed parent starts on ent/claude-opus-5-5, a BAA provider",
		parent: onSealedParent,
		call: fresh("deep"),
		expect: relaunched("ent/claude-opus-5-5"),
	},
	{
		title: "naming deep from a routing phi/auto parent starts on phi/claude-opus-5-5",
		parent: phiAuto,
		call: fresh("deep"),
		expect: relaunched("phi/claude-opus-5-5"),
	},
	{
		title: "continuing an ultra-a/claude-opus-5-5 delegate from a phi/sealed parent starts it on ent/claude-opus-5-5",
		parent: onSealedParent,
		call: { continues: "delegate-2" },
		expect: relaunched("ent/claude-opus-5-5"),
	},
	{
		title: "continuing an opencode-go/glm-5.3-flash delegate from a routing phi/auto parent starts on phi/sealed and says so",
		parent: phiAuto,
		call: { continues: "delegate-4" },
		expect: substitutedOn(
			"phi/sealed",
			"The model `opencode-go/glm-5.3-flash`, which neither phi-router nor a BAA provider carries, so this delegate runs on phi/sealed.",
		),
	},
	{
		title: "continuing an openai/gpt-6.1-sol delegate from an ent parent starts on it",
		parent: onEnt,
		call: { continues: "delegate-3" },
		expect: relaunched("openai/gpt-6.1-sol"),
	},
	{
		title: "continuing an ultra-a/claude-opus-5-5 delegate from an ultra-b parent starts on it",
		parent: on("ultra-b", opus.id),
		call: { continues: "delegate-2" },
		expect: relaunched("ultra-a/claude-opus-5-5"),
	},
];

test.each(calls)("a delegate call $title", ({ parent, call, expect: expected }) =>
	runtime.runPromise(
		Effect.map(calledFrom(parent, call), (got) => {
			expect(got).toEqual(expected);
		}),
	),
);
