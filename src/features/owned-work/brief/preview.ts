import { uuidv7 } from "@earendil-works/pi-ai";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

import { BriefSources, briefSourcesLayer } from "#src/client/brief-sources/index.ts";
import { PiCli, piCliLayer } from "#src/client/pi/index.ts";
import {
	type Brief,
	childExtensions,
	type ChildRole,
	inheritedEnv,
	launch,
	levels,
} from "#src/features/owned-work/child.ts";
import { type Alias, aliases, ModelName, modelTable } from "#src/features/owned-work/models.ts";
import { workFilesOf } from "#src/features/owned-work/work.ts";
import { roleFieldsFor } from "./brief.ts";
import { parseProfile } from "./profile.ts";

export interface StagedLaunch {
	readonly name: string;
	readonly role: ChildRole;
	readonly level: number;
	readonly argv: ReadonlyArray<string>;
	readonly env: Readonly<Record<string, string>>;
}

const instructionsFolder = `${import.meta.dirname}/../../../../agent/instructions`;

const keyOf = ({ provider, id }: Alias) => `${provider}/${id}`;

const stagedModel = (name: ModelName) =>
	ModelName.$match(name, {
		Spelled: ({ key }) => key,
		Alias: ({ alias }) => Option.match(Rec.get(modelTable.aliases, alias), { onNone: () => alias, onSome: keyOf }),
	});

const goal = "Capture the system prompt each delegate gets.";

interface Staged extends Pick<Brief, "name" | "model" | "thinking" | "readOnly" | "instructions"> {
	readonly role: ChildRole;
	readonly level: number;
	readonly design: Option.Option<string>;
}

const bare = ({ name, role, level, design }: Pick<Staged, "name" | "role" | "level" | "design">): Staged => ({
	name,
	role,
	level,
	design,
	model: keyOf(aliases.judgment),
	thinking: Option.none(),
	readOnly: false,
	instructions: Option.none(),
});

const bareDelegates = [
	bare({ name: "owner", role: "owner", level: 2, design: Option.some("sketch.md") }),
	bare({ name: "owner-last-level", role: "owner", level: levels, design: Option.some("yours") }),
	bare({ name: "leaf", role: "leaf", level: 2, design: Option.none() }),
];

const onInstructionsFile = Effect.fn("onInstructionsFile")(function* (file: string) {
	const sources = yield* BriefSources;
	const profile = yield* Effect.flatMap(sources.read(`${instructionsFolder}/${file}`), parseProfile);
	const role = yield* Effect.fromOption(profile.role, () => `instructions file ${file} names no role`);
	const model = yield* Effect.fromOption(profile.model, () => `instructions file ${file} names no model`);

	const staged: Staged = {
		name: Str.replace(/\.md$/u, "")(file),
		role,
		level: 2,
		design: role === "owner" ? Option.some("yours") : Option.none(),
		model: stagedModel(model),
		thinking: profile.thinking,
		readOnly: profile.readOnly,
		instructions: Option.some({ file, text: profile.text }),
	};

	return staged;
});

interface Staging {
	readonly cwd: string;
	readonly dir: string;
	readonly message: string;
	readonly state: string;
	readonly env: Readonly<Record<string, string | undefined>>;
}

export const stagedLaunches = Effect.fn("stagedLaunches")(function* ({ cwd, dir, message, state, env }: Staging) {
	const services = yield* Layer.build(Layer.merge(piCliLayer(childExtensions), briefSourcesLayer));
	const cli = Context.get(services, PiCli);
	const files = yield* Context.get(services, BriefSources).list(instructionsFolder);

	const withInstructions = yield* Effect.provideContext(Effect.forEach(files, onInstructionsFile), services);
	const workFiles = yield* Effect.provideContext(workFilesOf(cwd, Option.some(state)), services);

	const launches = Effect.forEach([...withInstructions, ...bareDelegates], ({ level, role, design, ...staged }) =>
		Effect.gen(function* () {
			const roleFields = yield* roleFieldsFor({ cwd: state, state: Option.some(state), role, design });
			const brief: Brief = { ...staged, message, goal, state: Option.some(state), ...workFiles, ...roleFields };

			const spec = yield* launch(cli)({
				brief,
				level,
				childSession: { cwd, dir: `${dir}/${brief.name}`, id: uuidv7() },
				passEnv: inheritedEnv(env),
			});

			const launched: StagedLaunch = {
				name: brief.name,
				role,
				level,
				argv: spec.argv,
				env: { ...spec.env, PI_OWNED_WORK_SLICE: `pi-ow-prompts-${brief.name}` },
			};

			return launched;
		}),
	);

	return yield* Effect.provideContext(launches, services);
});
