import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Str from "effect/String";
import { type Static, Type } from "typebox";

import { BriefSources } from "#src/client/brief-sources/index.ts";
import { Design, type StagedBrief } from "#src/client/pi/index.ts";
import type { Brief, ChildRole } from "#src/features/owned-work/child.ts";
import {
	type ModelCaller,
	modelChoices,
	modelDescription,
	modelNameOf,
	modelOf,
	type ModelTable,
} from "#src/features/owned-work/models.ts";
import { reviewsParam } from "#src/features/owned-work/review/index.ts";
import { BadDelegate } from "#src/features/owned-work/work.ts";
import { lastFolder } from "#src/features/state-folder/index.ts";
import { parseProfile } from "./profile.ts";

const sharedDocumentAliases = [["GLOSSARY.md", "GLOSSARY-MAP.md"], ["CODING_STANDARDS.md"], ["docs/adr/"]];

export const workFilesOf = Effect.fn("workFilesOf")(
	function* (folder: string, state: Option.Option<string>) {
		const sources = yield* BriefSources;
		const firstFound = (paths: ReadonlyArray<string>) => Effect.findFirst(paths, (path) => sources.exists(path));
		const root = yield* sources.repoRoot(folder);

		const documents = Option.match(root, {
			onNone: () => [],
			onSome: (top) => Arr.map(sharedDocumentAliases, (names) => Arr.map(names, (name) => `${top}/${name}`)),
		});

		const stateFile = state.pipe(
			Option.map((own) => `${own}/STATE.md`),
			Option.toArray,
		);

		const destinationFile = yield* firstFound(stateFile);
		const found = yield* Effect.forEach(documents, firstFound);

		return { destinationFile, sharedDocuments: Arr.getSomes(found) };
	},
	Effect.mapError(({ path, why }) => BadDelegate.make({ why: `cannot read ${path}: ${why}` })),
);

export const roleUses =
	"`owner` for a slice to build, verify and commit, which may need a playbook or delegates of its own; `leaf` for one bounded task, such as a search, a review, a verification lane or a scoped edit";

const roleDescription = `${roleUses}. A leaf gets no playbooks and starts no delegates. It overrides the role an instructions file names, and is required when the file names none.`;

const words = (description: string) => Type.Optional(Type.String({ pattern: String.raw`\S`, description }));

const sketchHeading = "## Synthesis decision";

export const designChoice = `the path of a sketch file that holds \`${sketchHeading}\`, which the owner builds to, or \`yours\`, which leaves the shape to the owner`;

const designParam = Type.String({
	pattern: String.raw`\S`,
	description: `Who settled an owner's design: ${designChoice}. Required for an owner, refused for a leaf.`,
});

export const delegateParams = ({
	table,
	roles,
	inheritsGoal,
}: {
	readonly table: ModelTable;
	readonly roles: ReadonlyArray<ChildRole>;
	readonly inheritsGoal: boolean;
}) => {
	const model = Type.String({ description: modelDescription(table) });

	const params = Type.Object({
		name: words(
			"A few words that tell this delegate apart from the others you run, such as `review auth` or `classify opus 2`. The human sees it in their list of running agents. Required unless you name `continues`.",
		),
		message: words(
			"Everything the delegate needs. You cannot send it anything while it runs, and it cannot ask you. Required unless you name `continues`.",
		),
		continues: words(
			"The ref of a settled delegate you started, to run again in its own session with its name and brief. Only `message` and `group` go with it. Without a message, it checks what its last tool call did before it reruns it.",
		),
		goal: words("The user's goal in one sentence. It defaults to your own goal and is required when you have none."),
		state: words(
			"The work's state folder. It defaults to yours. Its `facts.md` reaches every delegate, its `owner.md` only owners.",
		),
		role: Type.Optional(Type.Unsafe<ChildRole>({ type: "string", enum: [...roles], description: roleDescription })),
		design: Type.Optional(designParam),
		instructionsFile: Type.Optional(
			Type.String({
				description:
					"A file whose text the delegate keeps as standing instructions, such as one a skill names. `~/` and paths relative to your working directory work.",
			}),
		),
		model: Type.Optional(model),
		cwd: Type.Optional(
			Type.String({
				description: "The folder the delegate starts in, such as its own git worktree. Yours when left out.",
			}),
		),
		group: words(
			"A few words for what the group's work has in common, such as `principles eval`. Delegates you start with the same `group` while that group runs join it, and it wakes you once with all their answers.",
		),
		reviews: Type.Optional(reviewsParam),
	});

	return inheritsGoal ? params : Type.Object(params.properties, { required: ["goal"] });
};

export type DelegateParams = ReturnType<typeof delegateParams>;

export type Caller = ModelCaller &
	Pick<ExtensionContext, "cwd"> & {
		readonly sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
	};

const delegateThinking = "high";

const absoluteOf = Effect.fn("absoluteOf")(function* (cwd: string, file: string) {
	const path = yield* Path.Path;
	const home = yield* Effect.orElseSucceed(Config.String("HOME"), () => "~");

	return path.resolve(cwd, Str.replace(/^~(?=\/)/u, home)(file));
});

const instructionsOf = Effect.fn("instructionsOf")(function* (cwd: string, file: string) {
	const sources = yield* BriefSources;
	const absolute = yield* absoluteOf(cwd, file);

	const text = yield* Effect.mapError(sources.read(absolute), ({ why }) =>
		BadDelegate.make({ why: `cannot read instructionsFile ${file}: ${why}` }),
	);

	const profile = yield* Effect.mapError(parseProfile(text), (why) =>
		BadDelegate.make({ why: `instructionsFile ${file} has bad frontmatter: ${why}` }),
	);

	return { ...profile, file: absolute };
});

const folderOf = Effect.fn("folderOf")(function* (cwd: string, folder: string, refused: string) {
	const sources = yield* BriefSources;
	const absolute = yield* absoluteOf(cwd, folder);

	return yield* Effect.mapError(sources.realFolder(absolute), ({ why }) =>
		BadDelegate.make({ why: `${refused} ${folder}: ${why}` }),
	);
});

const stateFile = (state: Option.Option<string>, name: string) =>
	Option.match(state, {
		onNone: () => Effect.succeedNone,
		onSome: (folder) => {
			const file = `${folder}/${name}`;

			return Effect.flatMap(BriefSources, (sources) => sources.readIfPresent(file)).pipe(
				Effect.mapError(({ why }) => BadDelegate.make({ why: `cannot read ${file}: ${why}` })),
			);
		},
	});

const designOf = Effect.fn("designOf")(function* (cwd: string, named: string) {
	if (named === "yours") {
		return Design.cases.Yours.make({});
	}

	const sources = yield* BriefSources;
	const path = yield* absoluteOf(cwd, named);

	const text = yield* Effect.mapError(sources.read(path), ({ why }) =>
		BadDelegate.make({ why: `cannot read design sketch ${named}: ${why}` }),
	);

	return /^## Synthesis decision\s*$/mu.test(text)
		? Design.cases.Sketch.make({ path })
		: yield* BadDelegate.make({ why: `design sketch ${named} holds no \`${sketchHeading}\`: name ${designChoice}` });
});

interface RoleChoice {
	readonly cwd: string;
	readonly state: Option.Option<string>;
	readonly role: ChildRole;
	readonly design: Option.Option<string>;
}

export const roleFieldsFor = Effect.fn("roleFieldsFor")(function* ({ cwd, state, role, design }: RoleChoice) {
	const facts = yield* stateFile(state, "facts.md");

	if (role === "leaf") {
		return Option.isSome(design)
			? yield* BadDelegate.make({ why: "a leaf takes no `design`: leave it out, or start an owner" })
			: { role, facts };
	}

	const named = yield* Effect.fromOption(design, () =>
		BadDelegate.make({ why: `name a \`design\` for an owner: ${designChoice}` }),
	);

	const ownerRules = yield* stateFile(state, "owner.md");

	return { role, facts, ownerRules, design: yield* designOf(cwd, named) };
});

const goalMissing = BadDelegate.make({
	why: "name a `goal`: the user's goal in one sentence. A root's call must name it, and every delegate below inherits it",
});

interface Parent {
	readonly ctx: Caller;
	readonly table: ModelTable;
	readonly roles: ReadonlyArray<ChildRole>;
	readonly inherited: Option.Option<Pick<StagedBrief, "goal" | "state">>;
}

const workOf = Effect.fn("workOf")(function* (
	{ ctx, inherited }: Parent,
	call: Static<DelegateParams>,
	cwd: Option.Option<string>,
) {
	const goal = yield* Effect.fromOption(
		Option.orElse(Option.fromUndefinedOr(call.goal), () => Option.map(inherited, (own) => own.goal)),
		() => goalMissing,
	);

	const namedState = yield* Effect.transposeOption(
		Option.map(Option.fromUndefinedOr(call.state), (folder) => folderOf(ctx.cwd, folder, "cannot use state folder")),
	);

	const state = Option.orElse(namedState, () =>
		Option.orElse(
			Option.flatMap(inherited, (own) => own.state),
			() => lastFolder(ctx.sessionManager.getBranch()),
		),
	);

	const workFolder = Option.getOrElse(cwd, () => ctx.cwd);
	const files = yield* workFilesOf(workFolder, state);

	return { goal, state, ...files };
});

const roleOf = (named: Option.Option<ChildRole>, roles: ReadonlyArray<ChildRole>) =>
	Effect.fromOption(named, () =>
		BadDelegate.make({ why: `name a role, since neither the call nor an instructions file does: ${roleUses}` }),
	).pipe(
		Effect.filterOrFail(
			(role) => Arr.contains(roles, role),
			() => BadDelegate.make({ why: "you start leaves only, at the last owner level: name role `leaf`" }),
		),
	);

export const parseCall = Effect.fn("parseCall")(function* (
	parent: Parent,
	call: Static<DelegateParams> & { readonly name: string; readonly message: string },
) {
	const { ctx, table, roles } = parent;

	const cwd = yield* Effect.transposeOption(
		Option.map(Option.fromUndefinedOr(call.cwd), (folder) => folderOf(ctx.cwd, folder, "cannot start in cwd")),
	);

	const profile = yield* Effect.transposeOption(
		Option.map(Option.fromUndefinedOr(call.instructionsFile), (file) => instructionsOf(ctx.cwd, file)),
	);

	const role = yield* roleOf(
		Option.orElse(Option.fromUndefinedOr(call.role), () => Option.flatMap(profile, (own) => own.role)),
		roles,
	);

	const named = Option.orElse(Option.map(Option.fromUndefinedOr(call.model), modelNameOf), () =>
		Option.flatMap(profile, (own) => own.model),
	);

	const wanted = yield* Effect.fromOption(named, () =>
		BadDelegate.make({
			why: `name a model, since neither the call nor an instructions file does: ${modelChoices(table)}`,
		}),
	);

	const { model, substitution } = yield* modelOf(ctx, table, wanted);
	const work = yield* workOf(parent, call, cwd);

	const roleFields = yield* roleFieldsFor({
		cwd: ctx.cwd,
		state: work.state,
		role,
		design: Option.fromUndefinedOr(call.design),
	});

	const brief: Brief = {
		name: call.name,
		message: call.message,
		...work,
		...roleFields,
		model,
		thinking: Option.orElseSome(
			Option.flatMap(profile, (own) => own.thinking),
			() => delegateThinking,
		),
		readOnly: Option.exists(profile, (own) => own.readOnly),
		instructions: Option.map(profile, ({ file, text }) => ({ file, text })),
	};

	return { brief, cwd, substitution };
});
