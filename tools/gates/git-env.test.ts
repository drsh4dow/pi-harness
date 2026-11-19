import { afterAll, expect, test } from "bun:test";

import * as Effect from "effect/Effect";

const repo = `${import.meta.dirname}/../..`;
const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/git-env-test-${process.pid}`;

const stateOf = (dir: string) =>
	Effect.promise(() => Bun.$`git -C ${dir} for-each-ref && git -C ${dir} config core.bare`.text());

afterAll(() => Effect.runPromise(Effect.promise(() => Bun.$`rm -rf ${scratch}`)));

test("a test that runs git in its own folder leaves alone the repository git exported to bun run test", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* Effect.promise(
				() =>
					Bun.$`git init -q -b main ${scratch} && git -C ${scratch} -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m scratch`,
			);
			const before = yield* stateOf(scratch);

			const gitExported = {
				GIT_DIR: `${scratch}/.git`,
				GIT_WORK_TREE: scratch,
				GIT_INDEX_FILE: `${scratch}/.git/index`,
			};

			const { exitCode } = yield* Effect.promise(() =>
				Bun.$`bun run test ./tools/gates/fixtures/git-env/own-repo.ts`
					.cwd(repo)
					.env({ ...Bun.env, ...gitExported })
					.nothrow()
					.quiet(),
			);

			const after = yield* stateOf(scratch);

			expect(exitCode).toBe(0);
			expect(after).toBe(before);
		}),
	));
