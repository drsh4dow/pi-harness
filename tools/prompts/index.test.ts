import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Str from "effect/String";

const repo = Str.replace(/\/tools\/prompts$/u, "")(import.meta.dirname);

const fakePi = `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "--version") {
	console.log("9.9.9");
} else {
	const seen = [process.argv.slice(2).join(" "), process.env.PATH, fs.readdirSync(process.env.PI_CODING_AGENT_DIR).join(" ")];
	fs.writeFileSync(process.env.PI_PROMPTS_CAPTURE, JSON.stringify({ system: seen.map((text) => ({ text })) }));
}
`;

const linked = ["package.json", "node_modules", "src", ".gitignore", "tools/harness.ts", "tools/prompts/state"];

const scratchHarness = (tmp: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = `${tmp}/harness`;

		yield* fs.makeDirectory(`${root}/tools/prompts`, { recursive: true });
		yield* fs.makeDirectory(`${root}/agent`);
		yield* Effect.forEach(["index.ts", "capture.ts", "render.ts"], (file) =>
			fs.copyFile(`${import.meta.dirname}/${file}`, `${root}/tools/prompts/${file}`),
		);
		yield* Effect.forEach(linked, (entry) => fs.symlink(`${repo}/${entry}`, `${root}/${entry}`));

		const entries = yield* fs.readDirectory(`${repo}/agent`);

		yield* Effect.forEach(entries, (entry) => fs.symlink(`${repo}/agent/${entry}`, `${root}/agent/${entry}`));

		return root;
	});

const captured = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const tmp = yield* fs.makeTempDirectoryScoped({ directory: "/tmp" });
	const root = yield* scratchHarness(tmp);
	const userAgent = `${tmp}/user-agent`;

	yield* Effect.forEach([`${tmp}/bin`, `${tmp}/project`, userAgent], (folder) => fs.makeDirectory(folder));
	yield* fs.writeFileString(`${tmp}/bin/pi`, fakePi, { mode: 0o755 });
	yield* Effect.forEach(["borrowed.json", "SYSTEM.md"], (entry) => fs.writeFileString(`${userAgent}/${entry}`, "x"));

	const path = Arr.join([`${repo}/node_modules/.bin`, `${tmp}/bin`, Bun.env["PATH"] ?? ""], ":");

	const cli = Bun.spawn([process.execPath, `${root}/tools/prompts/index.ts`, `${tmp}/project`], {
		env: { ...Bun.env, PATH: path, PI_CODING_AGENT_DIR: userAgent },
		stdout: "ignore",
		stderr: "ignore",
	});

	const code = yield* Effect.promise(() => cli.exited);

	const report = yield* fs.readFileString(`${root}/system-prompts.md`);
	const borrowedAfter = yield* fs.exists(`${root}/agent/borrowed.json`);

	return { root, code, report, borrowedAfter };
}).pipe(Effect.scoped);

const kinds = ["## Stock pi", "## Root agent", "(owner, level 2)", "(owner, level 3)", "(leaf, level 2)"];

test("prompts captures each kind of pi through this checkout's capture extension, with the user's pi and agent folder", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const { root, code, report, borrowedAfter } = yield* captured;
			const sections = Arr.drop(Str.split(report, "\n## "), 1);
			const captureOptions = ` -e ${root}/tools/prompts/capture.ts -p -- `;
			const rootSection = Arr.findFirst(sections, Str.startsWith("Root agent"));

			expect({
				code,
				missingKinds: Arr.filter(kinds, (kind) => !Str.includes(kind)(report)),
				withoutCapture: Arr.filter(sections, (section) => !Str.includes(captureOptions)(section)),
				packageBins: Str.includes("node_modules/.bin")(report),
				borrowedDuringRun: Option.exists(rootSection, Str.includes("borrowed.json")),
				borrowedAfter,
			}).toEqual({
				code: 0,
				missingKinds: [],
				withoutCapture: [],
				packageBins: false,
				borrowedDuringRun: true,
				borrowedAfter: false,
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	));
