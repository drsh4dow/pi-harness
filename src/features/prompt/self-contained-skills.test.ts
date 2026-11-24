import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Order from "effect/Order";
import * as Str from "effect/String";

const skills = Bun.fileURLToPath(new URL("../../../agent/skills/", import.meta.url));

/** Skills published on skills.sh, which run in any agent with only their own folder. */
const selfContained = ["making-videos"];

/** A path into this harness or this machine, a pi tool field, a pi command, or a citation of another skill by name. */
const harnessOnly = /~\/\.pi\b|\.pi\/agent|~\/Projects\/|instructionsFile|\/reload\b|\*\*[a-z0-9-]+\*\* skill/u;

const hitsIn = (file: string, text: string) =>
	Arr.flatMap(Str.split("\n")(text), (line, index) =>
		harnessOnly.test(line) ? [`${file}:${String(index + 1)}: ${Str.slice(0, 80)(Str.trim(line))}`] : [],
	);

const isText = (file: string) => !/\.(?:ttf|woff2|pyc)$|__pycache__|node_modules/u.test(file);

/** Every hit in one entry of a skill's folder. A folder has none. */
const hitsInEntry = Effect.fn("hitsInEntry")(function* (entry: string) {
	const fs = yield* FileSystem.FileSystem;
	const info = yield* fs.stat(`${skills}${entry}`);

	if (info.type !== "File") {
		return [];
	}

	const text = yield* fs.readFileString(`${skills}${entry}`);

	return hitsIn(entry, text);
});

/** Every hit in the text files of one skill's folder. */
const hitsInSkill = Effect.fn("hitsInSkill")(function* (skill: string) {
	const fs = yield* FileSystem.FileSystem;
	const entries = yield* fs.readDirectory(`${skills}${skill}`, { recursive: true });
	const textEntries = Arr.map(Arr.filter(entries, isText), (entry) => `${skill}/${entry}`);
	const hits = yield* Effect.forEach(Arr.sort(textEntries, Order.String), hitsInEntry);

	return Arr.flatten(hits);
});

test("a harness path, a pi tool field or a cited skill is a hit, and a public install line is not", () => {
	const lines = [
		"Run `~/.pi/agent/skills/making-videos/scripts/check.sh --setup`.",
		"Start delegates with `instructionsFile: cold-reader.md`.",
		"Upload it with the **dumpfile** skill.",
		"npx skills add drsh4dow/pi-harness --skill making-videos -g",
	];

	const hits = hitsIn("f.md", Arr.join(lines, "\n"));

	expect(Arr.map(hits, Str.slice(0, 7))).toEqual(["f.md:1:", "f.md:2:", "f.md:3:"]);
});

test("no file in a self-contained skill reaches outside its folder into the harness", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const hits = yield* Effect.forEach(selfContained, hitsInSkill);

			expect(Arr.flatten(hits)).toEqual([]);
		}).pipe(Effect.provide(NodeServices.layer)),
	));
