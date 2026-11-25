import { afterAll, expect, test } from "bun:test";

import { loadSkills } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

import type { Role } from "#src/features/owned-work/index.ts";
import { skillsFor } from "./skills.ts";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/skills-test-${String(process.pid)}`;

const harness = `${import.meta.dirname}/../../..`;

const run = <Out, Err>(effect: Effect.Effect<Out, Err, FileSystem.FileSystem>) =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const every: ReadonlyArray<Role> = ["root", "owner", "leaf"];

const rows: ReadonlyArray<{ name: string; text: string; fits: ReadonlyArray<Role>; problems: number }> = [
	{
		name: "a skill with no `for` fits every role",
		text: "---\nname: a\ndescription: A.\n---\nBody.",
		fits: every,
		problems: 0,
	},
	{
		name: "`for: [root]` hides a skill from owners and leaves",
		text: "---\nname: a\ndescription: A.\nfor: [root]\n---\nBody.",
		fits: ["root"],
		problems: 0,
	},
	{
		name: "`for: [owner, leaf]` hides a skill from the root",
		text: "---\nname: a\ndescription: A.\nfor: [owner, leaf]\n---\nBody.",
		fits: ["owner", "leaf"],
		problems: 0,
	},
	{
		name: "an unknown role leaves the skill out for every role and reports it",
		text: "---\nname: a\ndescription: A.\nfor: [delegate]\n---\nBody.",
		fits: [],
		problems: 1,
	},
];

test.each(Arr.map(rows, (row, index) => ({ ...row, index })))("$name", ({ index, ...row }) =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const filePath = `${scratch}/${String(index)}/SKILL.md`;

			yield* fs.makeDirectory(`${scratch}/${String(index)}`, { recursive: true });
			yield* fs.writeFileString(filePath, row.text);

			const seen = yield* Effect.forEach(every, (role) =>
				Effect.map(skillsFor({ role, skills: [{ filePath }] }), ({ skills, problems }) => ({
					role,
					fits: Arr.isReadonlyArrayNonEmpty(skills),
					problems: problems.length,
				})),
			);

			expect(seen).toEqual(
				Arr.map(every, (role) => ({ role, fits: row.fits.includes(role), problems: row.problems })),
			);
		}),
	),
);

test("a skill file that cannot be read is left out and reported", () =>
	run(
		Effect.gen(function* () {
			const { skills, problems } = yield* skillsFor({
				role: "root",
				skills: [{ filePath: `${scratch}/missing/SKILL.md` }],
			});

			expect({ skills, problems: problems.length }).toEqual({ skills: [], problems: 1 });
		}),
	));

const shippedSkills = Effect.sync(
	() =>
		loadSkills({
			cwd: scratch,
			agentDir: `${harness}/agent`,
			skillPaths: [`${harness}/src/features/web`],
			includeDefaults: true,
		}).skills,
);

test("every shipped skill's `for` names known roles", () =>
	run(
		Effect.gen(function* () {
			const skills = yield* shippedSkills;
			const { problems } = yield* skillsFor({ role: "root", skills });

			expect(Arr.isReadonlyArrayNonEmpty(skills)).toBe(true);
			expect(Arr.map(problems, ({ file, why }) => `${Str.replace(harness, "")(file)}: ${why}`)).toEqual([]);
		}),
	));

const dirOf = (filePath: string) => Str.replace(/\/SKILL\.md$/u, "")(filePath);

const nameOf = (filePath: string) => Str.replace(/^.*\//u, "")(dirOf(filePath));

const hiddenFromModel = /^disable-model-invocation: true$/mu;

const everyDocInSkillFolder = (filePath: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const dir = dirOf(filePath);
		const entries = yield* fs.readDirectory(dir, { recursive: true });

		return yield* Effect.forEach(Arr.filter(entries, Str.endsWith(".md")), (doc) =>
			Effect.map(fs.readFileString(`${dir}/${doc}`), (text) => ({ doc: `${nameOf(filePath)}/${doc}`, text })),
		);
	});

const pointsAt = (text: string, names: ReadonlyArray<string>) =>
	Arr.filter(names, (name) => Str.includes(`\`${name}\``)(text) || Str.includes(`**${name}**`)(text));

test("a skill points at another written as `name` or **name**, and a bare name points at none", () => {
	expect(pointsAt("Run `grilling`, then **tdd**, then handoff.", ["grilling", "tdd", "handoff"])).toEqual([
		"grilling",
		"tdd",
	]);
});

const childRoles: ReadonlyArray<Role> = ["owner", "leaf"];

test("no skill an owner or a leaf loads points it at a skill hidden from its role", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const skills = yield* shippedSkills;
			const forRoot = yield* skillsFor({ role: "root", skills });

			const pointers = yield* Effect.forEach(childRoles, (role) =>
				Effect.gen(function* () {
					const forRole = yield* skillsFor({ role, skills });

					const hidden = Arr.difference(
						Arr.map(forRoot.skills, ({ filePath }) => nameOf(filePath)),
						Arr.map(forRole.skills, ({ filePath }) => nameOf(filePath)),
					);

					const modelLoads = yield* Effect.filter(forRole.skills, ({ filePath }) =>
						Effect.map(fs.readFileString(filePath), (skillText) => !hiddenFromModel.test(skillText)),
					);

					return yield* Effect.forEach(modelLoads, ({ filePath }) =>
						Effect.gen(function* () {
							const docs = yield* everyDocInSkillFolder(filePath);
							const texts = Arr.map(docs, ({ text }) => text);

							return Arr.map(
								pointsAt(Arr.join(texts, "\n"), hidden),
								(name) => `${role}: ${nameOf(filePath)} → ${name}`,
							);
						}),
					);
				}),
			);

			expect(Arr.flatten(Arr.flatten(pointers))).toEqual([]);
		}),
	));

const contradictions = [
	{ phrase: /reset --hard/u, rule: "<git> preserves unrelated changes", delegateSkillsOnly: false },
	{
		phrase: /ask before delet/iu,
		rule: "Subtract first deletes once it knows why the code exists",
		delegateSkillsOnly: false,
	},
	{
		phrase: /when you run as a delegate/iu,
		rule: "the owner and leaf role files own what a delegate does",
		delegateSkillsOnly: false,
	},
	{
		phrase: /multiple agents or sessions/iu,
		rule: "the delegate rules say when parts run in parallel",
		delegateSkillsOnly: false,
	},
	{
		phrase: /tasks one at a time/iu,
		rule: "the agent leading a build hands each slice to an owner",
		delegateSkillsOnly: false,
	},
	{
		phrase: /STOP YOUR TURN/u,
		rule: "a delegate has no later turn, and the roles decide when to stop",
		delegateSkillsOnly: true,
	},
];

const contradictedRules = ({
	text,
	seenByDelegate,
}: {
	readonly text: string;
	readonly seenByDelegate: boolean;
}): ReadonlyArray<string> =>
	Arr.flatMap(contradictions, ({ phrase, rule, delegateSkillsOnly }) =>
		phrase.test(text) && (!delegateSkillsOnly || seenByDelegate) ? [rule] : [],
	);

test("STOP YOUR TURN contradicts the roles only in a skill a delegate loads, and reset --hard in any skill", () => {
	const stopRule = "a delegate has no later turn, and the roles decide when to stop";

	expect([
		contradictedRules({ text: "Then STOP YOUR TURN.", seenByDelegate: true }),
		contradictedRules({ text: "Then STOP YOUR TURN.", seenByDelegate: false }),
		contradictedRules({ text: "Run git reset --hard.", seenByDelegate: false }),
	]).toEqual([[stopRule], [], ["<git> preserves unrelated changes"]]);
});

test("no skill contradicts a rule the always-on prompt owns", () =>
	run(
		Effect.gen(function* () {
			const skills = yield* shippedSkills;
			const forDelegates = yield* Effect.forEach(childRoles, (role) => skillsFor({ role, skills }));

			const delegateSees = new Set(
				Arr.flatMap(forDelegates, (each) => Arr.map(each.skills, ({ filePath }) => filePath)),
			);

			const found = yield* Effect.forEach(skills, ({ filePath }) =>
				Effect.map(everyDocInSkillFolder(filePath), (docs) =>
					Arr.flatMap(docs, ({ doc, text }) =>
						Arr.map(
							contradictedRules({ text, seenByDelegate: delegateSees.has(filePath) }),
							(rule) => `${doc}: ${rule}`,
						),
					),
				),
			);

			expect(Arr.flatten(found)).toEqual([]);
		}),
	));

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`.quiet())));
