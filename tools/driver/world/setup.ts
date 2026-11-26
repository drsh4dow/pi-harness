import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

const resourceKeys = new Set(["packages", "extensions", "skills", "prompts", "themes"]);

const replaced = (_theirs: Schema.Json, ours: Schema.Json) => ours;

export const settingsOf = (input: {
	readonly human: Schema.JsonObject;
	readonly overrides: Schema.JsonObject;
}): Schema.JsonObject =>
	Rec.union(
		Rec.filter(input.human, (_value, key) => !resourceKeys.has(key)),
		input.overrides,
		replaced,
	);

const isJsonObject = Schema.is(Schema.JsonObject);

const merged = (theirs: Schema.Json, ours: Schema.Json): Schema.Json =>
	isJsonObject(theirs) && isJsonObject(ours) ? Rec.union(theirs, ours, merged) : ours;

export const modelsOf = (input: {
	readonly human: Option.Option<Schema.JsonObject>;
	readonly providers: Readonly<Record<string, Schema.JsonObject>>;
	readonly windowed?: string | undefined;
}): Schema.JsonObject => {
	const theirs = Option.getOrElse(input.human, (): Schema.JsonObject => ({}));

	const theirProviders = Option.getOrElse(
		Option.filter(Option.fromUndefinedOr(theirs["providers"]), isJsonObject),
		(): Schema.JsonObject => ({}),
	);

	const providers = Rec.map(Rec.union(theirProviders, input.providers, replaced), (entry, name) =>
		name === input.windowed ? merged(theirProviders[name] ?? {}, entry) : entry,
	);

	return Rec.union(theirs, { providers }, replaced);
};

export interface Setup {
	readonly offline?: boolean;
	readonly rootEnv?: Readonly<Record<string, string>>;
	readonly settings?: Schema.JsonObject;
	readonly models?: Readonly<Record<string, Schema.JsonObject>>;
	readonly files?: (run: { readonly home: string; readonly project: string }) => Files;
}

type Files = Readonly<Record<string, Schema.JsonObject>>;

export interface RunSetup extends Setup {
	readonly windowed?: string | undefined;
}

export const setupOf = (spec: Setup & { readonly model: string; readonly contextWindow?: number }): RunSetup => {
	if (spec.contextWindow === undefined) {
		return spec;
	}

	const [provider, ...id] = Str.split(spec.model, "/");
	const window = spec.contextWindow;

	const compaction = {
		enabled: true,
		reserveTokens: Math.floor(window / 4),
		keepRecentTokens: Math.floor(window / 8),
	};

	const entry: Schema.JsonObject = { modelOverrides: { [Arr.join(id, "/")]: { contextWindow: window } } };

	return {
		...spec,
		settings: Rec.union({ compaction }, spec.settings ?? {}, replaced),
		models: Rec.union({ [provider]: entry }, spec.models ?? {}, (_ours, theirs: Schema.JsonObject) => theirs),
		windowed: spec.models?.[provider] === undefined ? provider : undefined,
	};
};
