import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import type { ChildPi, Design, PiCli, SessionAddress, StagedBrief } from "#src/client/pi/index.ts";
import { type RunSpec, terminalNameOf } from "#src/client/terminals/index.ts";
import type { ReviewTarget } from "#src/features/pr/index.ts";

export const levels = 3;

export const Role = Schema.Literals(["root", "owner", "leaf"]);

export type Role = typeof Role.Type;

export const ChildRole = Schema.Literals(["owner", "leaf"]);

export type ChildRole = typeof ChildRole.Type;

/** The roles a prompt file fits, from its frontmatter's `for`. */
export const Roles = Role.pipe(Schema.NonEmptyArray);

const levelUpTo = (maximum: number) =>
	Schema.FiniteFromString.pipe(Schema.check(Schema.isBetween({ minimum: 2, maximum })));

const ChildEnv = Schema.Union([
	Schema.Struct({
		PI_OWNED_WORK_LEVEL: levelUpTo(levels),
		PI_OWNED_WORK_ROLE: Schema.Literal("owner"),
		PI_OWNED_WORK_SLICE: Schema.String,
	}),
	Schema.Struct({
		PI_OWNED_WORK_LEVEL: levelUpTo(levels + 1),
		PI_OWNED_WORK_ROLE: Schema.Literal("leaf"),
		PI_OWNED_WORK_SLICE: Schema.String,
	}),
]);

export type Self = Data.TaggedEnum<{
	Root: { readonly role: "root"; readonly level: 1 };
	Delegate: { readonly role: ChildRole; readonly level: number; readonly slice: string };
}>;

export const Self = Data.taggedEnum<Self>();

export const selfFromEnv = Effect.fn("selfFromEnv")(function* (env: Readonly<Record<string, string | undefined>>) {
	if (env["PI_OWNED_WORK_LEVEL"] === undefined) {
		return Self.Root({ role: "root", level: 1 });
	}

	const child = yield* Schema.decodeUnknownEffect(ChildEnv)(env);

	return Self.Delegate({
		role: child.PI_OWNED_WORK_ROLE,
		level: child.PI_OWNED_WORK_LEVEL,
		slice: child.PI_OWNED_WORK_SLICE,
	});
});

export const childRoles = (self: Self): ReadonlyArray<ChildRole> => {
	if (self.role === "leaf") {
		return [];
	}

	return self.level < levels ? ["owner", "leaf"] : ["leaf"];
};

export const atLevel = ({ level, role }: { readonly level: number; readonly role: ChildRole }) => ({
	oomScoreAdj: String(Math.round((1000 * (level - 1)) / levels)),
	env: { PI_OWNED_WORK_LEVEL: String(level), PI_OWNED_WORK_ROLE: role },
});

export const inheritedEnv = (env: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> =>
	Rec.filterMap(env, (value, key) =>
		value === undefined || /^HC_TERMINAL_|^PI_OWNED_WORK_/u.test(key) ? Result.failVoid : Result.succeed(value),
	);

export const withAgentBin = (agentDir: string) => (env: Readonly<Record<string, string | undefined>>) => {
	const bin = `${agentDir}/bin`;
	const path = env["PATH"] ?? "";
	const rest = path === "" ? [] : Arr.filter(Str.split(path, ":"), (folder) => folder !== bin);

	return { ...env, PATH: Arr.join([bin, ...rest], ":") };
};

export type ChildSession = SessionAddress;

const extensionsFolder = `${import.meta.dirname}/../../../agent/extensions`;

export const childExtensions: ReadonlyArray<string> = [
	`${extensionsFolder}/owned-work/index.ts`,
	`${extensionsFolder}/checks/index.ts`,
	`${extensionsFolder}/prompt/index.ts`,
	`${extensionsFolder}/web/index.ts`,
	`${extensionsFolder}/claude-accounts/index.ts`,
	`${extensionsFolder}/phi/index.ts`,
	`${extensionsFolder}/compaction/index.ts`,
	`${extensionsFolder}/cache/index.ts`,
	`${extensionsFolder}/loaded/index.ts`,
];

interface BriefCommon extends Omit<ChildPi, "session" | "brief"> {
	readonly goal: string;
	readonly state: Option.Option<string>;
	readonly facts: Option.Option<string>;
	/** The state folder's `STATE.md`, which holds the work's destination and its acceptance criteria. */
	readonly destinationFile: Option.Option<string>;
	/** The glossary, coding standards and ADR folder at the root of the repo the delegate works in, by absolute path. */
	readonly sharedDocuments: ReadonlyArray<string>;
	readonly instructions: Option.Option<{ readonly file: string; readonly text: string }>;
}

export type Brief =
	| (BriefCommon & {
			readonly role: "owner";
			readonly ownerRules: Option.Option<string>;
			readonly design: Design;
			readonly review?: never;
	  })
	| (BriefCommon & {
			readonly role: "leaf";
			readonly ownerRules?: never;
			readonly review?: ReviewTarget;
	  });

const stagedOf = (brief: Brief): StagedBrief => {
	const common = {
		goal: brief.goal,
		state: brief.state,
		facts: brief.facts,
		destinationFile: brief.destinationFile,
		sharedDocuments: brief.sharedDocuments,
		instructions: Option.map(brief.instructions, ({ text }) => text),
	};

	if (brief.role === "owner") {
		return { role: "owner", ...common, ownerRules: brief.ownerRules, design: brief.design };
	}

	if (brief.review === undefined) {
		return { role: "leaf", ...common };
	}

	const { repo, number, head } = brief.review;

	return { role: "leaf", ...common, review: { pr: `${repo}#${String(number)}`, head } };
};

export interface LaunchRequest {
	readonly brief: Brief;
	readonly level: number;
	readonly childSession: ChildSession;
	readonly passEnv: Readonly<Record<string, string>>;
}

export const launch = (cli: (typeof PiCli)["Service"]) => (request: LaunchRequest) => {
	const { oomScoreAdj, env } = atLevel({ level: request.level, role: request.brief.role });

	return Effect.map(
		cli.launch({ ...request.brief, session: request.childSession, brief: stagedOf(request.brief) }),
		(argv): Pick<RunSpec, "name" | "argv" | "env"> => ({
			name: terminalNameOf(request.brief.name),
			argv: ["choom", "-n", oomScoreAdj, "--", ...argv],
			env: { ...request.passEnv, ...env },
		}),
	);
};
