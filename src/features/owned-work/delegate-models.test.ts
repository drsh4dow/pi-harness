import { expect, test } from "bun:test";

import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { callerOf, continued, delegate, router, runtime, started } from "./brief.fixture.ts";
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

/** What a delegate runs: a model, pinned or not, a model with the sentence its tool result carries, or a refusal. */
type Runs = string | { readonly model: string; readonly substituted: string };

interface Row {
	readonly from: string;
	readonly parent: Model<Api>;
	/** The parent's session id. The fake phi-router holds `held-parent` pinned. */
	readonly session?: string;
	readonly name: string;
	readonly runs: Runs;
}

const delegateModel = ({ parent, session = "parent", name }: Row) => {
	const caller = {
		model: parent,
		cwd: "/",
		modelRegistry: { getAll: () => registry },
		sessionManager: { getSessionId: () => session },
	};

	return runtime.runPromise(
		modelOf(caller, modelTable, modelNameOf(name)).pipe(
			Effect.match({
				onFailure: (): Runs => "refused",
				onSuccess: ({ model, pin, substitution }): Runs =>
					Option.match(substitution, {
						onNone: () => (pin ? `${model}, pinned` : model),
						onSome: (substituted) => ({ model, substituted }),
					}),
			}),
		),
	);
};

const phiAuto = on("phi", "auto");

const onEnt = on("ent", opus.id);

const onOpenai = on("openai", "gpt-6.1-sol");

/** What a protected parent's delegate runs when neither phi-router nor a BAA provider carries the id named. */
const onSealed = (named: string) => ({
	model: "phi/sealed",
	substituted: `${named}, which neither phi-router nor a BAA provider carries, so this delegate runs on phi/sealed.`,
});

const divergent = onSealed("The alias `divergent` names opencode-go/glm-5.3-flash");

/** A routing parent's delegate runs an id phi-router carries as `phi/<id>`, unpinned, so the router picks per request. */
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

/** A held parent's delegate runs the same models, and every `phi` one of them pinned. */
const heldRows = (from: string, parent: Model<Api>, session = "parent"): ReadonlyArray<Row> =>
	Arr.map(
		[
			{ name: "judgment", runs: "phi/claude-opus-5-5, pinned" },
			{ name: "fable", runs: "phi/claude-fable-5-2, pinned" },
			{ name: "ultra-b/claude-opus-5-5", runs: "phi/claude-opus-5-5, pinned" },
			{ name: "phi/auto", runs: "phi/auto, pinned" },
			{ name: "investigator", runs: "openai/gpt-6.1-sol" },
			{ name: "ent/claude-opus-5-5", runs: "ent/claude-opus-5-5" },
			{ name: "divergent", runs: divergent },
			{
				name: "opencode-go/glm-5.3-flash",
				runs: onSealed("The model `opencode-go/glm-5.3-flash`"),
			},
		],
		(row) => ({ from, parent, session, ...row }),
	);

/** An open parent's delegate runs the alias's model, on the parent's provider when that provider has the id. */
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
	...heldRows("a phi/auto parent phi-router holds pinned", phiAuto, "held-parent"),
	...heldRows("a phi/sealed parent", on("phi", "sealed")),
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

/** What the delegate tool returns and starts for one call, and which sessions it had phi-router pin first. */
const calledFrom = (parent: Model<Api>, session: string, call: DelegateCall) => {
	const caller = {
		...callerOf(),
		model: parent,
		modelRegistry: { getAll: () => registry },
		sessionManager: { getBranch: () => [], getSessionId: () => session },
	};

	return Effect.map(
		Effect.promise(() => delegate.execute("call", call, undefined, undefined, caller)),
		({ isError, details }) => {
			continued.splice(0);

			const begun = started.splice(0);

			const pinnedFirst = Arr.map(router.pinned.splice(0), (id) =>
				Arr.some(begun, (one) => one.session === id) ? "its session" : id,
			);

			return { isError, details, started: Arr.map(begun, ({ brief }) => brief.model), pinnedFirst };
		},
	);
};

const handedTo = "end your turn; delegate-1 wakes you";

const relaunched = (model: string, pinnedFirst: Array<string> = []) => ({
	isError: false,
	details: { ref: "delegate-1", kind: "delegate", next: handedTo },
	started: [model],
	pinnedFirst,
});

const substitutedOn = (model: string, substituted: string) => ({
	isError: false,
	details: { ref: "delegate-1", kind: "delegate", next: handedTo, substituted },
	started: [model],
	pinnedFirst: new Array<string>(),
});

const refused = (why: string) => ({
	isError: true,
	details: { error: "BadDelegate", message: why },
	started: new Array<string>(),
	pinnedFirst: new Array<string>(),
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
	readonly session: string;
	readonly call: DelegateCall;
	readonly expect: ReturnType<typeof relaunched | typeof substitutedOn | typeof refused>;
}

const calls: ReadonlyArray<CallRow> = [
	{
		title: "naming deep from a pinned phi/auto parent has phi-router pin the delegate's session, then starts it on phi/claude-opus-5-5",
		parent: phiAuto,
		session: "held-parent",
		call: fresh("deep"),
		expect: relaunched("phi/claude-opus-5-5", ["its session"]),
	},
	{
		title: "naming deep from a routing phi/auto parent starts on phi/claude-opus-5-5 and pins nothing",
		parent: phiAuto,
		session: "parent",
		call: fresh("deep"),
		expect: relaunched("phi/claude-opus-5-5"),
	},
	{
		title: "naming quick from a pinned phi/auto parent starts on openai/gpt-6-luna, a BAA provider, and pins nothing",
		parent: phiAuto,
		session: "held-parent",
		call: fresh("quick"),
		expect: relaunched("openai/gpt-6-luna"),
	},
	{
		title: "naming deep from a phi/auto parent phi-router cannot answer about is refused",
		parent: phiAuto,
		session: "lost-parent",
		call: fresh("deep"),
		expect: refused("cannot ask phi-router whether this session is pinned: connection refused"),
	},
	{
		title: "continuing an ultra-a/claude-opus-5-5 delegate from a pinned phi/auto parent pins its session and starts it on phi/claude-opus-5-5",
		parent: phiAuto,
		session: "held-parent",
		call: { continues: "delegate-2" },
		expect: relaunched("phi/claude-opus-5-5", ["its session"]),
	},
	{
		title: "continuing an opencode-go/glm-5.3-flash delegate from a routing phi/auto parent starts on phi/sealed and says so",
		parent: phiAuto,
		session: "parent",
		call: { continues: "delegate-4" },
		expect: substitutedOn(
			"phi/sealed",
			"The model `opencode-go/glm-5.3-flash`, which neither phi-router nor a BAA provider carries, so this delegate runs on phi/sealed.",
		),
	},
	{
		title: "continuing an openai/gpt-6.1-sol delegate from an ent parent starts on it",
		parent: onEnt,
		session: "parent",
		call: { continues: "delegate-3" },
		expect: relaunched("openai/gpt-6.1-sol"),
	},
	{
		title: "continuing an ultra-a/claude-opus-5-5 delegate from an ultra-b parent starts on it",
		parent: on("ultra-b", opus.id),
		session: "parent",
		call: { continues: "delegate-2" },
		expect: relaunched("ultra-a/claude-opus-5-5"),
	},
];

test.each(calls)("a delegate call $title", ({ parent, session, call, expect: expected }) =>
	runtime.runPromise(
		Effect.map(calledFrom(parent, session, call), (got) => {
			expect(got).toEqual(expected);
		}),
	),
);
