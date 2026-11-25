import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

import { PhiRouter } from "#src/client/providers/index.ts";
import { accountOf, type PlanReader, roomiestAccount } from "#src/features/claude-accounts/index.ts";
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
	readonly modelRegistry: PlanReader;
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

const resolvedOf = (ctx: ModelCaller, table: ModelTable, name: ModelName) =>
	ModelName.$match(name, {
		Spelled: ({ key }) => {
			const [provider, ...id] = Str.split(key, "/");

			return Effect.succeed({
				id: Arr.join(id, "/"),
				spelled: Option.some(provider),
				model: key,
				naming: `The model \`${key}\``,
				whyClause: "",
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
					whyClause: `, which the alias ${alias} names,`,
				})),
			),
	});

type Resolved = Effect.Success<ReturnType<typeof resolvedOf>>;

const isRegistered = (ctx: ModelCaller) => (key: string) =>
	Arr.some(ctx.modelRegistry.getAll(), ({ provider, id }) => `${provider}/${id}` === key);

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

interface Placement {
	readonly model: string;
	readonly whyClause: string;
	readonly pin: boolean;
	readonly substitution: Option.Option<string>;
}

const routerPicks = ", which phi-router picks,";

const runs = (model: string, whyClause: string, pin: boolean): Placement => ({
	model,
	whyClause,
	pin,
	substitution: Option.none(),
});

const openPlacement = Effect.fn("openPlacement")(function* (
	ctx: ModelCaller,
	{ spelled, model, id, whyClause }: Resolved,
) {
	const account = accountOf(Arr.headNonEmpty(Str.split(model, "/")));

	if (Option.isSome(spelled) || Option.isNone(account)) {
		return runs(model, whyClause, false);
	}

	const roomiest = yield* roomiestAccount({ registry: ctx.modelRegistry, from: account.value, id });

	return runs(`${roomiest.id}/${id}`, whyClause, false);
});

const substituted = (naming: string): Placement => {
	const model = `${phiProvider}/${sealedId}`;
	const sentence = `${naming}, which neither phi-router nor a BAA provider carries, so this delegate runs on ${model}.`;

	return { model, whyClause: routerPicks, pin: false, substitution: Option.some(sentence) };
};

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

export const modelOf = Effect.fn("modelOf")(function* (ctx: ModelCaller, table: ModelTable, name: ModelName) {
	const resolved = yield* resolvedOf(ctx, table, name);
	const standing = yield* standingOf(ctx);

	const placement =
		standing === "open" ? yield* openPlacement(ctx, resolved) : protectedPlacement(ctx, standing, resolved);

	if (!isRegistered(ctx)(placement.model)) {
		return yield* BadDelegate.make({
			why: `model ${placement.model}${placement.whyClause} is not in the model registry`,
		});
	}

	return placement;
});
