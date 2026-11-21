import { afterAll, beforeAll, expect, test } from "bun:test";

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/diff-size-test-${String(process.pid)}`;

const repo = `${scratch}/repo`;

const git = (...args: ReadonlyArray<string>) =>
	Effect.promise(() =>
		Bun.$`git -C ${repo} -c user.name=t -c user.email=t@t -c commit.gpgsign=false ${args}`.quiet().text(),
	);

const commitFiles = (files: Readonly<Record<string, string | Uint8Array>>) =>
	Effect.gen(function* () {
		yield* Effect.forEach(Rec.toEntries(files), ([path, body]) =>
			Effect.promise(() => Bun.write(`${repo}/${path}`, body)),
		);
		yield* git("add", ".");
		yield* git("commit", "-q", "-m", "files");
	});

const baseCommit = Effect.gen(function* () {
	yield* Effect.promise(() => Bun.$`git init -q -b main ${repo}`.quiet());
	yield* commitFiles({
		".gitattributes": "gen.ts linguist-generated\nprompts/*.md -linguist-documentation\n",
		"src/app.ts": "a\nb\n",
	});

	return yield* Effect.map(git("rev-parse", "--short=7", "HEAD"), Str.trim);
});

const branchFromBase = Effect.gen(function* () {
	yield* git("checkout", "-q", "-b", "work");
	yield* commitFiles({
		"src/app.ts": "a\nc\nd\n",
		"src/app.test.ts": "t\nt\nt\n",
		"README.md": "read me\n",
		"prompts/role.md": "you are\nan agent\n",
		"bun.lock": "l\nl\nl\nl\n",
		"gen.ts": "g\ng\ng\ng\ng\n",
		"logo.png": new Uint8Array([0, 1, 2, 0, 255]),
	});

	yield* git("checkout", "-q", "main");
	yield* commitFiles({ "src/later.ts": "on main after the branch\n" });
	yield* git("checkout", "-q", "work");
	yield* git("update-ref", "refs/remotes/origin/main", "main");
	yield* git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
});

const built = { base: "" };

beforeAll(() =>
	Effect.runPromise(
		Effect.gen(function* () {
			built.base = yield* baseCommit;
			yield* branchFromBase;
		}),
	),
);

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`.quiet())));

const diffSize = (cwd: string, args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const run = Bun.spawn([`${import.meta.dirname}/diff-size`, ...args], {
			cwd,
			env: { ...Bun.env, GIT_CEILING_DIRECTORIES: scratch },
			stderr: "pipe",
		});

		const { code, stdout, stderr } = yield* Effect.all({
			code: Effect.promise(() => run.exited),
			stdout: Effect.promise(() => new Response(run.stdout).text()),
			stderr: Effect.promise(() => new Response(run.stderr).text()),
		});

		const lines = Arr.filter(Str.split(`${stdout}${stderr}`, "\n"), Str.isNonEmpty);

		return { code, lines };
	});

test.each([
	{ name: "sizes the branch against the base it names", args: ["main"] },
	{ name: "sizes the branch against the default branch when it names no base", args: [] },
])("diff-size $name, by kind of path, from the merge base", ({ args }) =>
	Effect.runPromise(
		Effect.map(diffSize(repo, args), (got) => {
			expect(got).toEqual({
				code: 0,
				lines: [`size: production +4 -1, tests +3 -0, docs +1 -0, other +9 -0 (base ${built.base})`],
			});
		}),
	),
);

test("diff-size sizes the head it names in place of HEAD", () =>
	Effect.runPromise(
		Effect.map(diffSize(repo, ["work", "main"]), (got) => {
			expect(got).toEqual({
				code: 0,
				lines: [`size: production +1 -0, tests +0 -0, docs +0 -0, other +0 -0 (base ${built.base})`],
			});
		}),
	));

test.each([
	{ name: "an unknown base", cwd: repo, args: ["nope"] },
	{ name: "a folder outside a git repository", cwd: scratch, args: [] },
])("diff-size in $name prints one line on what is wrong and fails", ({ cwd, args }) =>
	Effect.runPromise(
		Effect.map(diffSize(cwd, args), ({ code, lines }) => {
			expect({ failed: code !== 0, lines: lines.length }).toEqual({ failed: true, lines: 1 });
		}),
	),
);
