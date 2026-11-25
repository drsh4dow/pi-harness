import { afterAll, expect, test } from "bun:test";

import * as Effect from "effect/Effect";

const repo = `${import.meta.dirname}/../..`;
const bin = `${repo}/node_modules/.bin`;
const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/gates-test-${process.pid}`;

const copyOf = (fixture: string, gate: string): Effect.Effect<string> =>
	Effect.gen(function* () {
		const dir = `${scratch}/${gate}`;

		yield* Effect.promise(() => Bun.$`mkdir -p ${dir} && cp -r ${import.meta.dirname}/fixtures/${fixture}/. ${dir}`);
		yield* Effect.promise(
			() => Bun.$`ln -s ${repo}/node_modules ${dir}/node_modules && cp ${repo}/tsconfig.json ${dir}/`,
		);
		yield* Effect.promise(() =>
			Bun.write(
				`${dir}/package.json`,
				`{ "type": "module", "imports": { "#src/*": "./src/*", "#tools/*": "./tools/*" } }\n`,
			),
		);
		yield* Effect.promise(() => Bun.write(`${dir}/.oxlintrc.json`, `{ "extends": ["${repo}/.oxlintrc.jsonc"] }\n`));

		return dir;
	});

const run = (cwd: string, command: ReadonlyArray<string>): Effect.Effect<{ code: number; output: string }> =>
	Effect.gen(function* () {
		const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });

		const [stdout, stderr, code] = yield* Effect.promise(() =>
			Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]),
		);

		return { code, output: stdout + stderr };
	});

interface GateRun {
	readonly fixture: string;
	readonly gate: string;
	readonly command: ReadonlyArray<string>;
	readonly messages: ReadonlyArray<string>;
}

const failsWith = ({ fixture, gate, command, messages }: GateRun): Promise<void> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const dir = yield* copyOf(fixture, gate);
			const { code, output } = yield* run(dir, command);

			expect(code).not.toBe(0);

			for (const message of messages) {
				expect(output).toContain(message);
			}
		}),
	);

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`)));

test("the boundary gate rejects a client that imports a type from a feature", () =>
	failsWith({
		fixture: "boundaries",
		gate: "boundaries",
		command: [`${bin}/depcruise`, "src", "--config", `${repo}/.dependency-cruiser.json`, "--output-type", "err-long"],
		messages: ["error client-imports: src/client/leaky/index.ts → src/features/sample/index.ts"],
	}));

test("the boundary gate rejects an import three folders deep that reaches past an edge file in src", () =>
	failsWith({
		fixture: "edge-file",
		gate: "edge-file-src",
		command: [`${bin}/depcruise`, "src", "--config", `${repo}/.dependency-cruiser.json`, "--output-type", "err-long"],
		messages: [
			"error edge-file: src/features/sample/parts/deep/user.ts → src/features/sample/other/inner/leaf.ts",
			"Import a folder from outside it only through its edge file, index.ts.",
		],
	}));

test("the boundary gate rejects an import three folders deep that reaches past an edge file in tools", () =>
	failsWith({
		fixture: "edge-file",
		gate: "edge-file-tools",
		command: [
			`${bin}/depcruise`,
			"tools",
			"--config",
			`${repo}/.dependency-cruiser.json`,
			"--output-type",
			"err-long",
		],
		messages: [
			"error tools-edge-file: tools/driver/guides/deep/user.ts → tools/driver/align/inner/leaf.ts",
			"Import a folder from outside it only through its edge file, index.ts.",
		],
	}));

test("the bans reject an Effect runner, a disk import and Bun.env in a feature, and a fixed sleep in test code", () =>
	failsWith({
		fixture: "bans",
		gate: "oxlint-bans",
		command: [`${bin}/oxlint`, "--format", "default", "src"],
		messages: [
			"hand it to run or fork from piHost in #src/client/pi/index.ts",
			"Read and write disk through the src/client/ folder that owns the file",
			"call eventually from #src/primitives/eventually.ts",
			"Read the environment in the entry file and pass it in",
		],
	}));

test("the delegate model ban rejects a registry lookup in owned-work outside models.ts", () =>
	failsWith({
		fixture: "bans",
		gate: "ast-grep-bans",
		command: [`${bin}/ast-grep`, "scan", "--config", `${repo}/sgconfig.yml`, "src"],
		messages: ["Call modelOf from src/features/owned-work/models.ts"],
	}));

test("the git ban rejects a git spawned outside src/client/git", () =>
	failsWith({
		fixture: "raw-git",
		gate: "raw-git",
		command: [`${bin}/ast-grep`, "scan", "--config", `${repo}/sgconfig.yml`, "src"],
		messages: [
			"Run git through `git` from #src/client/git/index.ts, which drops the caller's repository variables such as GIT_DIR.",
		],
	}));

test("the comment check rejects a line comment, a doc comment and an oxlint-disable directive", () =>
	failsWith({
		fixture: "comments",
		gate: "no-comments",
		command: [`${bin}/ast-grep`, "scan", "--config", `${repo}/sgconfig.yml`, "--filter", "^no-comments", "src"],
		messages: [
			"Delete this comment. Say it with a name, a type, a test, an issue or an ADR.",
			"// Says what the next line does.",
			"/** Says what wire is. */",
			"// oxlint-disable-next-line eslint/no-console",
		],
	}));

test("the ast-grep checks reject a dynamic import and a relative import without .ts", () =>
	failsWith({
		fixture: "comments",
		gate: "imports",
		command: [`${bin}/ast-grep`, "scan", "--config", `${repo}/sgconfig.yml`, "src"],
		messages: ["Import at the top of the file", "End a relative import in .ts"],
	}));

test("the width gate rejects a folder of 21 entries and names the folder rule", () =>
	failsWith({
		fixture: "width",
		gate: "width",
		command: ["sh", `${repo}/tools/width.sh`, "size-limits.txt", "src"],
		messages: [
			"src/features/wide holds 21 entries, over 20. Folder rule: move each concept into a folder named for it, with its edge file inside.",
		],
	}));

test("the file cap rejects a file of 601 lines", () =>
	failsWith({
		fixture: "max-lines",
		gate: "max-lines",
		command: [`${bin}/oxlint`, "--format", "default", "src"],
		messages: ["eslint(max-lines): File has too many lines (601)."],
	}));
