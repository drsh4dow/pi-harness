import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

import { PhiRouter } from "#src/client/phi-router/index.ts";
import { baaProviders, isBaa, isPhi, phiProvider, sealedId } from "#src/features/phi/index.ts";
import { BadDelegate } from "./work.ts";

export type ModelKey = `${string}/${string}`;

const isModelKey = (name: string): name is ModelKey => Str.includes("/")(name);

export type ModelName = Data.TaggedEnum<{
	Alias: { readonly alias: string };
	Spelled: { readonly key: ModelKey };
}>;

export const ModelName = Data.taggedEnum<ModelName>();

export const modelNameOf = (name: string): ModelName =>
	isModelKey(name) ? ModelName.Spelled({ key: name }) : ModelName.Alias({ alias: name });

/** A model and the work it is for. It runs on the caller's provider when that provider has the model id, so a delegate stays on its parent's account, and on `provider` otherwise. */
export interface Alias {
	readonly provider: string;
	readonly id: string;
	readonly use: string;
}

export interface ModelTable {
	readonly aliases: Readonly<Record<string, Alias>>;
	/** Model names, aliases or `provider/id`, one per seat. */
	readonly panel: ReadonlyArray<string>;
}

/** An alias never looks like a `provider/id`, so a spelled model always means that model. */
type Aliases = Readonly<Record<string, Alias> & Record<ModelKey, never>>;

export const aliases = {
	judgment: {
		provider: "ultra-a",
		id: "claude-opus-5-5",
		use: "implementation, design, synthesis, prose, and anything that needs taste",
	},
	worker: {
		provider: "ultra-a",
		id: "claude-opus-5-5",
		use: "swarm workers, verification lanes, mechanical edits, research, web search, investigation, scouting, and fan-out aggregation",
	},
	investigator: {
		provider: "openai",
		id: "gpt-6.1-sol",
		use: "a second opinion from another vendor: code review, audits, and the arena judge for a Claude parent",
	},
	fable: {
		provider: "ultra-a",
		id: "claude-fable-5-2",
		use: "a panel seat. Outside a panel only when the user names it for the task or two `judgment` runs of the same brief failed their check, and say which. Difficulty alone never qualifies",
	},
	divergent: {
		provider: "opencode-go",
		id: "glm-5.3-flash",
		use: "the arena skill's extra runner, and nothing else",
	},
} as const satisfies Aliases;

const panel: ReadonlyArray<keyof typeof aliases> = ["fable", "worker", "investigator"];

export const modelTable: ModelTable = { aliases, panel };

export type ModelCaller = Pick<ExtensionContext, "model" | "cwd"> & {
	readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "getAll">;
	readonly sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId">;
};

export const modelDescription = (table: ModelTable) => {
	const entries = Rec.toEntries(table.aliases);
	const named = Arr.map(entries, ([alias, { provider, id, use }]) => `\`${alias}\` (${provider}/${id}) for ${use}`);

	const sentences = [
		`\`provider/id\`, or an alias: ${Arr.join(named, "; ")}.`,
		"It overrides the model an instructions file names, and is required when the file names none.",
		`The panel, for work a skill runs once on each: ${Arr.join(table.panel, ", ")}.`,
	];

	return Arr.join(sentences, " ");
};

/** `provider/id` of the alias's model on the caller's provider when that provider has it, so a delegate stays on its parent's account. */
const aliasedModel = (ctx: ModelCaller, { provider: home, id }: Alias) => {
	const registry = ctx.modelRegistry.getAll();

	const own = Option.filter(Option.fromUndefinedOr(ctx.model), ({ provider }) =>
		Arr.some(registry, (model) => model.provider === provider && model.id === id),
	);

	const provider = Option.match(own, { onNone: () => home, onSome: (model) => model.provider });

	return `${provider}/${id}`;
};

export const modelChoices = (table: ModelTable) => {
	const named = Arr.map(Rec.keys(table.aliases), (alias) => `\`${alias}\``);

	return `an alias (${Arr.join(named, ", ")}) or a \`provider/id\`, your own included`;
};

/** The model a call names: its id, the provider a spelled `provider/id` names, and the model an open parent's delegate runs. */
const resolvedOf = (ctx: ModelCaller, table: ModelTable, name: ModelName) =>
	ModelName.$match(name, {
		Spelled: ({ key }) => {
			const [provider, ...id] = Str.split(key, "/");

			return Effect.succeed({
				id: Arr.join(id, "/"),
				spelled: Option.some(provider),
				model: key,
				naming: `The model \`${key}\``,
				source: "",
			});
		},
		Alias: ({ alias }) =>
			Effect.fromOption(Rec.get(table.aliases, alias), () =>
				BadDelegate.make({ why: `${alias} is not an alias: name ${modelChoices(table)}` }),
			).pipe(
				Effect.map((entry) => ({
					id: entry.id,
					spelled: Option.none<string>(),
					model: aliasedModel(ctx, entry),
					naming: `The alias \`${alias}\` names ${entry.provider}/${entry.id}`,
					source: `, which the alias ${alias} names,`,
				})),
			),
	});

type Resolved = Effect.Success<ReturnType<typeof resolvedOf>>;

const isRegistered = (ctx: ModelCaller) => (key: string) =>
	Arr.some(ctx.modelRegistry.getAll(), ({ provider, id }) => `${provider}/${id}` === key);

/**
 * How a parent stands toward PHI. A parent on a `phi` model routes, or is held when phi-router pins it or it runs
 * `phi/sealed`. A parent on a BAA provider is held too, since no judge saw what it holds. Any other parent is open.
 */
type Standing = "open" | "routing" | "held";

const standingOf = Effect.fn("standingOf")(function* (ctx: ModelCaller) {
	const parent = ctx.model;

	if (parent !== undefined && isBaa(parent.provider)) {
		return "held" satisfies Standing;
	}

	if (!isPhi(parent)) {
		return "open" satisfies Standing;
	}

	if (parent?.id === sealedId) {
		return "held" satisfies Standing;
	}

	const router = yield* PhiRouter;

	const pinned = yield* Effect.mapError(router.pinned(ctx.sessionManager.getSessionId()), ({ why }) =>
		BadDelegate.make({ why: `cannot ask phi-router whether this session is pinned: ${why}` }),
	);

	return pinned ? ("held" satisfies Standing) : ("routing" satisfies Standing);
});

/** Where a delegate runs, why, and whether phi-router pins its session before it starts. */
interface Placement {
	readonly model: string;
	/** Why it runs there, as the refusal of a model the registry lacks words it. */
	readonly source: string;
	readonly pin: boolean;
	readonly substitution: Option.Option<string>;
}

const routerPicks = ", which phi-router picks,";

const runs = (model: string, source: string, pin: boolean): Placement => ({
	model,
	source,
	pin,
	substitution: Option.none(),
});

/** The whole run on `phi/sealed`, since nothing that may hold PHI carries the model `naming` names. */
const substituted = (naming: string): Placement => {
	const model = `${phiProvider}/${sealedId}`;
	const sentence = `${naming}, which neither phi-router nor a BAA provider carries, so this delegate runs on ${model}.`;

	return { model, source: routerPicks, pin: false, substitution: Option.some(sentence) };
};

/**
 * A protected parent's delegate. A spelled BAA model runs as named. Any other name, a `phi` model's included, names a
 * model id, which runs as `phi/<id>` when phi-router carries it, so the router picks the account per request. Else the
 * first BAA provider that carries the id runs it, and else the whole run lands on `phi/sealed`. A held parent's
 * delegate on a `phi` model is pinned, so every request of it goes to a BAA account.
 */
const protectedPlacement = (ctx: ModelCaller, standing: Exclude<Standing, "open">, resolved: Resolved): Placement => {
	const carries = (provider: string) => isRegistered(ctx)(`${provider}/${resolved.id}`);
	const pin = standing === "held";
	const baa = Arr.findFirst(baaProviders, carries);

	if (Option.exists(resolved.spelled, isBaa)) {
		return runs(resolved.model, "", false);
	}

	if (carries(phiProvider)) {
		return runs(`${phiProvider}/${resolved.id}`, routerPicks, pin);
	}

	return Option.match(baa, {
		onSome: (provider) => runs(`${provider}/${resolved.id}`, routerPicks, false),
		onNone: () => substituted(resolved.naming),
	});
};

/**
 * A protected session's delegate runs where phi-router keeps session content inside its boundary. `substitution` says
 * when the whole run lands on another model because nothing that may hold PHI carries the one named.
 */
export const modelOf = Effect.fn("modelOf")(function* (ctx: ModelCaller, table: ModelTable, name: ModelName) {
	const resolved = yield* resolvedOf(ctx, table, name);
	const standing = yield* standingOf(ctx);

	const placement =
		standing === "open" ? runs(resolved.model, resolved.source, false) : protectedPlacement(ctx, standing, resolved);

	if (!isRegistered(ctx)(placement.model)) {
		return yield* BadDelegate.make({
			why: `model ${placement.model}${placement.source} is not in the model registry`,
		});
	}

	return placement;
});
