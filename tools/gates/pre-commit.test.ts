import { afterAll, expect, test } from "bun:test";

import * as Effect from "effect/Effect";

const repo = `${import.meta.dirname}/../..`;
const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/pre-commit-test-${process.pid}`;
const formatted = "export const a = 1;\n";
const misformatted = "export const a   =  1\n";

const hookExitWith = (name: string, file: { readonly staged: string; readonly working: string }) =>
	Effect.gen(function* () {
		const dir = `${scratch}/${name}`;

		yield* Effect.promise(
			() =>
				Bun.$`git init -q ${dir} && cp ${repo}/.oxfmtrc.json ${dir}/ && ln -s ${repo}/node_modules ${dir}/node_modules`,
		);
		yield* Effect.promise(() => Bun.write(`${dir}/a.ts`, file.staged));
		yield* Effect.promise(() => Bun.$`git -C ${dir} add a.ts .oxfmtrc.json`);
		yield* Effect.promise(() => Bun.write(`${dir}/a.ts`, file.working));

		return yield* Effect.promise(() => Bun.$`${repo}/.githooks/pre-commit`.cwd(dir).nothrow().quiet()).pipe(
			Effect.map(({ exitCode }) => exitCode),
		);
	});

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`)));

test("the pre-commit hook rejects a misformatted staged file whose working copy is formatted", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const code = yield* hookExitWith("staged-bad", { staged: misformatted, working: formatted });

			expect(code).not.toBe(0);
		}),
	));

test("the pre-commit hook passes a formatted staged file whose working copy is misformatted", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const code = yield* hookExitWith("staged-good", { staged: formatted, working: misformatted });

			expect(code).toBe(0);
		}),
	));
