import { afterAll, beforeAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import type { Static } from "typebox";

import { PiCli, piCliLayer, readStagedBrief } from "#src/client/pi/index.ts";
import { callerOf, delegate, goal, started } from "#src/features/owned-work/brief.fixture.ts";
import { launch } from "#src/features/owned-work/child.ts";
import { briefBlocks } from "#src/features/prompt/index.ts";
import type { DelegateParams } from "./brief.ts";

const root = `${Bun.env["TMPDIR"] ?? "/tmp"}/owned-work-work-files-test-${String(process.pid)}`;

const staging = ManagedRuntime.make(Layer.provideMerge(piCliLayer([]), NodeServices.layer));

const plainState = `${root}/plain`;

const alignedState = `${root}/aligned`;

beforeAll(() =>
	Promise.all([
		Bun.write(`${plainState}/facts.md`, "\n"),
		Bun.write(`${alignedState}/STATE.md`, "# Cap the retries\n"),
	]),
);

afterAll(() =>
	Effect.runPromise(
		Effect.andThen(
			Effect.promise(() => staging.dispose()),
			Effect.promise(() => Bun.$`rm -rf ${root}`.quiet()),
		),
	),
);

const repoWith = (name: string, files: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const repo = `${root}/${name}`;
		const written = Arr.map(["src/index.ts", ...files], (file) => Bun.write(`${repo}/${file}`, "\n"));

		yield* Effect.promise(() => Promise.all(written));
		yield* Effect.promise(() => Bun.$`git init -q ${repo}`.quiet());

		return repo;
	});

const workBlockOf = (call: Static<DelegateParams>, id: string) =>
	Effect.gen(function* () {
		const pi = yield* PiCli;
		const session = { id, cwd: "/", dir: `${root}/delegates` };

		yield* Effect.promise(() => delegate.execute("call", call, undefined, undefined, callerOf()));

		const { brief } = yield* Effect.fromOption(Arr.head(started.splice(0)));

		yield* launch(pi)({ brief, level: 2, childSession: session, passEnv: {} });

		const staged = yield* readStagedBrief(session);

		return Option.map(Str.match(/<work>\n[\s\S]*?\n<\/work>/u)(briefBlocks(staged)), ([block]) => block);
	});

const leaf = { name: "m", message: "m", role: "leaf", model: "quick", goal } as const;

const workBlock = (lines: ReadonlyArray<string>) =>
	Option.some(Arr.join(["<work>", `The user's goal: ${goal}`, ...lines, "</work>"], "\n"));

const readFirst = "Read the parts of them that cover your area before you name a thing or write code.";

test("a delegate in a git repo reads in <work> where the work's STATE.md and the repo's shared documents are", () =>
	staging.runPromise(
		Effect.gen(function* () {
			const repo = yield* repoWith("documented", ["GLOSSARY.md", "CODING_STANDARDS.md", "docs/adr/0001-retries.md"]);
			const block = yield* workBlockOf({ ...leaf, state: alignedState, cwd: `${repo}/src` }, "documented");

			expect(block).toEqual(
				workBlock([
					`The work's state folder: ${alignedState}`,
					`The work's destination and acceptance criteria live in ${alignedState}/STATE.md.`,
					`Your repo's shared documents: ${repo}/GLOSSARY.md, ${repo}/CODING_STANDARDS.md, ${repo}/docs/adr/`,
					readFirst,
				]),
			);
		}),
	));

test("a repo with a glossary map and no glossary lists the map, and nothing for the documents it lacks", () =>
	staging.runPromise(
		Effect.gen(function* () {
			const repo = yield* repoWith("mapped", ["GLOSSARY-MAP.md"]);
			const block = yield* workBlockOf({ ...leaf, state: plainState, cwd: `${repo}/src` }, "mapped");

			expect(block).toEqual(
				workBlock([
					`The work's state folder: ${plainState}`,
					`Your repo's shared documents: ${repo}/GLOSSARY-MAP.md`,
					readFirst,
				]),
			);
		}),
	));

test("with no shared document in its repo, or no repo, and no STATE.md, a delegate's <work> holds its goal and state folder only", () =>
	staging.runPromise(
		Effect.gen(function* () {
			const repo = yield* repoWith("bare", []);
			const inBareRepo = yield* workBlockOf({ ...leaf, state: plainState, cwd: `${repo}/src` }, "bare");
			const outsideRepos = yield* workBlockOf({ ...leaf, state: plainState }, "outside");
			const today = workBlock([`The work's state folder: ${plainState}`]);

			expect([inBareRepo, outsideRepos]).toEqual([today, today]);
		}),
	));
