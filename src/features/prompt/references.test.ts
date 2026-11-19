import { expect, test } from "bun:test";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Match from "effect/Match";
import * as Order from "effect/Order";
import * as Str from "effect/String";

const harness = Bun.fileURLToPath(new URL("../../..", import.meta.url));

const promptFolders = [
	"agent/roles",
	"agent/principles",
	"agent/playbooks",
	"agent/skills",
	"agent/instructions",
	"agent/references",
	"agent/prompts",
	"src/features/web",
	"docs/agents",
];

const looseFiles = ["agent/SYSTEM.md", "AGENTS.md", "CODING_STANDARDS.md", "GLOSSARY.md"];

const skillFolders = ["agent/skills", "src/features/web"];

const untrackedRuntimePaths = ["agent/sessions/", "agent/phi-router.json"];

type Reference = { readonly at: string } & (
	| { readonly kind: "skill"; readonly name: string; readonly form: "mention" | "command" | "bareName" }
	| { readonly kind: "path"; readonly path: string }
	| { readonly kind: "section"; readonly title: string; readonly path: string }
);

type Cited<Kind extends Reference["kind"]> = Extract<Reference, { kind: Kind }>;

type Audience = "model" | "human";

interface Skill {
	readonly dir: string;
	readonly hidden: boolean;
}

interface Groups {
	readonly whole: string;
	readonly [group: string]: string | undefined;
}

const word = "[a-z][a-z0-9-]*[a-z0-9]";

const token = new RegExp(`(?<![\\w/-])[*\`]{1,2}(?<name>${word})[*\`]{1,2}`, "gu");

const notAnExample = String.raw`(?<!(?:\b[Aa]n?|'s) )`;

const skillMention = new RegExp(
	`${notAnExample}(?<![*\`\\w])(?:[*\`]{1,2}${word}[*\`]{1,2}(?:,? (?:and|or) |, ))*[*\`]{1,2}${word}[*\`]{1,2} skills?\\b`,
	"gu",
);

const command = new RegExp(`/skill:(?<name>${word})`, "gu");

const principle = new RegExp(`\\bprinciple-(?<name>${word})`, "gu");

const section = /\*\*(?<title>[^*]+)\*\* (?:in|of) `(?<path>[^`]+\.md)`/gu;

const cited = /`(?<quoted>[^`\s]+)`|~\/\.pi\/[^\s`)"']+/gu;

const link = /\]\((?<target>[^)\s]+)\)/gu;

const linkToSkill = /\[[^\]]*\]\([^)\s]*SKILL\.md\)/gu;

const dropAnchor = Str.replace(/#.*$/u, "");

const resolveRepoPath = (path: string, base = "") =>
	Str.slice(1)(decodeURIComponent(new URL(path, `file:///${base}`).pathname));

const harnessPathOf = (path: string): ReadonlyArray<string> => {
	const bare = dropAnchor(path);

	if (/[*<>[\]{}$]|\.\.\./u.test(bare)) {
		return [];
	}

	if (Str.startsWith("~/.pi/")(bare)) {
		return [resolveRepoPath(Str.slice(6)(bare))];
	}

	return /^(?:playbooks|principles)\/[a-z0-9-]+\.md$/u.test(bare) ? [`agent/${bare}`] : [];
};

const isPathLike = (target: string) => !/^(?:[a-z]+:|#|~)|[<[]/u.test(target) && /[./]/u.test(target);

const linkedPath = (file: string, target: string): ReadonlyArray<string> =>
	isPathLike(target) ? [resolveRepoPath(dropAnchor(target), file)] : [];

const groups = (expression: RegExp, line: string) =>
	Arr.map([...Str.matchAll(expression)(line)], (match): Groups => ({ ...match.groups, whole: match[0] }));

const skillsOnLine = (line: string, at: string): ReadonlyArray<Reference> => {
	const unlinked = Str.replaceAll(linkToSkill, "")(line);
	const mentions = Arr.map(groups(skillMention, unlinked), ({ whole }) => whole);
	const rest = Arr.reduce(mentions, unlinked, (text, mention) => Str.replace(mention, "")(text));

	const cite =
		(form: Cited<"skill">["form"]) =>
		({ name = "" }: Groups): Reference => ({ at, kind: "skill", name, form });

	return [
		...Arr.flatMap(mentions, (mention) => Arr.map(groups(token, mention), cite("mention"))),
		...Arr.map(groups(token, rest), cite("bareName")),
		...Arr.map(groups(command, line), cite("command")),
	];
};

const referencesOnLine = (file: string, line: string, at: string): ReadonlyArray<Reference> => {
	const path = (resolved: string): Reference => ({ at, kind: "path", path: resolved });

	return [
		...skillsOnLine(line, at),
		...Arr.map(groups(principle, line), ({ name = "" }) => path(`agent/principles/${name}.md`)),
		...Arr.flatMap(groups(section, line), ({ title = "", path: target = "" }) =>
			Arr.map(harnessPathOf(target), (resolved): Reference => ({ at, kind: "section", title, path: resolved })),
		),
		...Arr.flatMap(groups(cited, line), ({ whole, quoted }) => Arr.map(harnessPathOf(quoted ?? whole), path)),
		...Arr.flatMap(groups(link, line), ({ target = "" }) => Arr.map(linkedPath(file, target), path)),
	];
};

const noReferences: ReadonlyArray<Reference> = [];

const referencesIn = (file: string, text: string) =>
	Arr.reduce(Str.split("\n")(text), { fenced: false, found: noReferences }, ({ fenced, found }, line, index) => {
		if (/^\s*(?:```|~~~)/u.test(line)) {
			return { fenced: !fenced, found };
		}

		const here = fenced ? [] : referencesOnLine(file, line, `${file}:${String(index + 1)}`);

		return { fenced, found: [...found, ...here] };
	}).found;

const isMarkdown = (file: string) => Str.endsWith(".md")(file) && !Str.includes("node_modules")(file);

const listPromptFiles = Effect.fn("listPromptFiles")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;

	const listed = yield* Effect.forEach(promptFolders, (folder) =>
		Effect.gen(function* () {
			const found = yield* fs.exists(`${root}${folder}`);
			const files = found ? yield* fs.readDirectory(`${root}${folder}`, { recursive: true }) : [];

			return Arr.map(Arr.filter(files, isMarkdown), (file) => `${folder}/${file}`);
		}),
	);

	const loose = yield* Effect.filter(looseFiles, (file) => fs.exists(`${root}${file}`));

	return Arr.sort([...Arr.flatten(listed), ...loose], Order.String);
});

const skillAt = Effect.fn("skillAt")(function* (root: string, dir: string) {
	const fs = yield* FileSystem.FileSystem;
	const text = yield* fs.readFileString(`${root}${dir}SKILL.md`);
	const skill: Skill = { dir, hidden: parseFrontmatter(text).frontmatter["disable-model-invocation"] === true };

	return skill;
});

const listSkills = Effect.fn("listSkills")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;

	const found = yield* Effect.forEach(skillFolders, (folder) =>
		Effect.gen(function* () {
			const present = yield* fs.exists(`${root}${folder}`);
			const names = present ? yield* fs.readDirectory(`${root}${folder}`) : [];

			return yield* Effect.forEach(names, (name) =>
				skillAt(root, `${folder}/${name}/`).pipe(
					Effect.map((skill) => [[name, skill] as const]),
					Effect.catchTag("PlatformError", () => Effect.succeed([])),
				),
			);
		}),
	);

	return new Map(Arr.flatten(Arr.flatten(found)));
});

const skillProblems = (skills: ReadonlyMap<string, Skill>, audience: Audience, { at, name, form }: Cited<"skill">) => {
	const skill = skills.get(name);

	if (skill === undefined) {
		return form === "bareName" ? [] : [`${at}: no skill ${name}`];
	}

	return audience === "model" && form !== "command" && skill.hidden
		? [`${at}: routes to ${name}, which the model never sees`]
		: [];
};

const pathProblems = Effect.fn("pathProblems")(function* (root: string, { at, path }: Cited<"path">) {
	const fs = yield* FileSystem.FileSystem;
	const runtime = Arr.some(untrackedRuntimePaths, (prefix) => Str.startsWith(prefix)(path));
	const found = runtime || (yield* fs.exists(`${root}${path}`));

	return found ? [] : [`${at}: no file ${path}`];
});

const hasSection = (text: string, title: string) =>
	Arr.some(["**", ".**", ":**"], (end) => Str.includes(`**${title}${end}`)(text)) ||
	Arr.some(Str.split("\n")(text), (line) => /^#+ /u.test(line) && Str.replace(/^#+ /u, "")(line) === title);

const sectionProblems = Effect.fn("sectionProblems")(function* (root: string, { at, title, path }: Cited<"section">) {
	const fs = yield* FileSystem.FileSystem;
	const found = yield* fs.exists(`${root}${path}`);
	const text = found ? yield* fs.readFileString(`${root}${path}`) : "";

	return hasSection(text, title) ? [] : [`${at}: ${path} has no section ${title}`];
});

const problemsOf = (root: string, skills: ReadonlyMap<string, Skill>, audience: Audience) =>
	Match.type<Reference>().pipe(
		Match.discriminatorsExhaustive("kind")({
			skill: (reference) => Effect.succeed(skillProblems(skills, audience, reference)),
			path: (reference) => pathProblems(root, reference),
			section: (reference) => sectionProblems(root, reference),
		}),
	);

const brokenReferences = Effect.fn("brokenReferences")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;
	const skills = yield* listSkills(root);
	const files = yield* listPromptFiles(root);
	const hiddenDirs = Arr.flatMap([...skills.values()], ({ dir, hidden }) => (hidden ? [dir] : []));

	const broken = yield* Effect.forEach(files, (file) =>
		Effect.gen(function* () {
			const text = yield* fs.readFileString(`${root}${file}`);
			const audience: Audience = Arr.some(hiddenDirs, (dir) => Str.startsWith(dir)(file)) ? "human" : "model";

			return yield* Effect.forEach(referencesIn(file, text), problemsOf(root, skills, audience));
		}),
	);

	return Arr.flatten(Arr.flatten(broken));
});

const fixture = `${import.meta.dirname}/references-fixture/`;

test("a missing skill, principle, path or section is a hit, and so is a visible route to a hidden skill", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const found = yield* brokenReferences(fixture);

			expect(found).toEqual([
				"agent/playbooks/plan.md:1: routes to hidden, which the model never sees",
				"agent/playbooks/plan.md:1: no file agent/principles/gone.md",
				"agent/playbooks/plan.md:2: no file features/x.md",
				"agent/playbooks/plan.md:3: agent/playbooks/kept.md has no section Stacks",
				"agent/playbooks/plan.md:3: agent/playbooks/kept.md has no section Siz",
				"agent/playbooks/plan.md:4: no skill install-thing",
				"agent/skills/hidden/SKILL.md:6: no skill gone",
			]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));

test("every skill, principle, path and section a prompt file cites exists, and no visible file routes to a hidden skill", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const found = yield* brokenReferences(harness);

			expect(found).toEqual([]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));
