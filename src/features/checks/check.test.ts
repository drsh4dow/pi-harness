import { afterAll, expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

const scratch = `${Bun.env["TMPDIR"] ?? "/tmp"}/check-bin-test-${String(process.pid)}`;

const run = <Value, Failure>(body: Effect.Effect<Value, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(body, NodeServices.layer));

afterAll(() => run(Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(scratch, { recursive: true }))));

const spawnLimit = { timeout: 60_000 };

const spawned = (argv: ReadonlyArray<string>, { cwd, home }: { readonly cwd: string; readonly home: string }) =>
	Effect.gen(function* () {
		const env = { PATH: Bun.env["PATH"] ?? "", HOME: home, RUNS: `${home}/runs` };
		const child = Bun.spawn([...argv], { cwd, env, stderr: "pipe" });
		const read = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		const [out, err, code] = yield* Effect.promise(() => read);

		return { code, out, err };
	});

const seeded = (repo: string, home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const git = (...args: ReadonlyArray<string>) =>
			spawned(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, home });

		yield* fs.makeDirectory(`${repo}/sub`, { recursive: true });
		yield* fs.writeFileString(`${repo}/a.txt`, "a\n");
		yield* fs.writeFileString(`${repo}/sub/b.txt`, "b\n");
		yield* git("init", "-q");
		yield* git("add", ".");
		yield* git("commit", "-qm", "a");
	});

const world = (name: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const home = `${scratch}/${name}`;
		const repo = `${home}/repo`;

		yield* seeded(repo, home);

		const check = (script: string, options: ReadonlyArray<string> = [], cwd = repo) =>
			spawned([`${import.meta.dirname}/../../../agent/bin/check`, ...options, "--", "sh", "-c", script], {
				cwd,
				home,
			});

		const lines = Effect.orElseSucceed(fs.readFileString(`${home}/runs`), () => "");
		const runs = Effect.map(lines, (text) => Str.split(text, "\n").length - 1);

		return { fs, repo, check, runs };
	});

const passing = 'echo run >> "$RUNS"; echo tests ok';

test(
	"a second run on the same tree prints the first run's receipt and output instead of running, in its own folder only",
	() =>
		run(
			Effect.gen(function* () {
				const { repo, check, runs } = yield* world("same-tree");

				yield* check(passing);

				const second = yield* check(passing);
				const afterTwo = yield* runs;

				yield* check(passing, [], `${repo}/sub`);

				const afterSub = yield* runs;

				expect({ afterTwo, afterSub, code: second.code }).toEqual({ afterTwo: 1, afterSub: 2, code: 0 });
				expect(second.out).toMatch(/tests ok[\s\S]*did not run again/u);
			}),
		),
	spawnLimit,
);

test(
	"an untracked file, an edit to a tracked file, or --fresh runs it again",
	() =>
		run(
			Effect.gen(function* () {
				const { fs, repo, check, runs } = yield* world("changed-tree");

				yield* check(passing);
				yield* fs.writeFileString(`${repo}/new.txt`, "new\n");
				yield* check(passing);
				yield* fs.writeFileString(`${repo}/a.txt`, "a\nmore\n");
				yield* check(passing);
				yield* check(passing, ["--fresh"]);

				const count = yield* runs;

				expect(count).toBe(4);
			}),
		),
	spawnLimit,
);

test(
	"a failing run keeps its exit code and leaves no receipt, and neither does a pass that changed the tree",
	() =>
		run(
			Effect.gen(function* () {
				const { check, runs } = yield* world("no-receipt");
				const failing = 'echo run >> "$RUNS"; exit 3';
				const writing = 'echo run >> "$RUNS"; date +%s%N > made.txt';

				const failed = yield* check(failing);

				yield* check(failing);

				const wrote = yield* check(writing);

				yield* check(writing);

				const count = yield* runs;

				expect({ code: failed.code, count }).toEqual({ code: 3, count: 4 });
				expect(wrote.err).toContain("the tree changed while it ran");
			}),
		),
	spawnLimit,
);
