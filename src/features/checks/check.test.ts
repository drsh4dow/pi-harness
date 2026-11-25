import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

import { eventually } from "#src/primitives/eventually.ts";
import { scratchFolder } from "#src/primitives/scratch.fixture.ts";

const scratch = scratchFolder("check-bin-test");

const run = <Value, Failure>(body: Effect.Effect<Value, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(body, NodeServices.layer));

const spawnLimit = { timeout: 60_000 };

const path = Bun.env["PATH"] ?? "";

const checkBin = `${import.meta.dirname}/../../../agent/bin/check`;

const spawned = (argv: ReadonlyArray<string>, { cwd, home }: { readonly cwd: string; readonly home: string }) =>
	Effect.gen(function* () {
		const env = { PATH: path, HOME: home, RUNS: `${home}/runs` };
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
			spawned([checkBin, ...options, "--", "sh", "-c", script], {
				cwd,
				home,
			});

		const lines = Effect.orElseSucceed(fs.readFileString(`${home}/runs`), () => "");
		const runs = Effect.map(lines, (text) => Str.split(text, "\n").length - 1);

		return { fs, home, repo, check, runs };
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
				expect(second.out).toBe("tests ok\n");
				expect(second.err).toContain("did not run again");
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

test(
	"a check's own stdout and stderr stay apart, the same on a receipt as on the run, with the receipt on stderr",
	() =>
		run(
			Effect.gen(function* () {
				const { check } = yield* world("streams");
				const printing = `echo run >> "$RUNS"; printf '{"a":1}\\n'; echo warned >&2`;

				const first = yield* check(printing);
				const second = yield* check(printing);

				expect([first.out, second.out]).toEqual(['{"a":1}\n', '{"a":1}\n']);
				expect(first.err).toStartWith("warned\n");
				expect(second.err).toStartWith("warned\n");
				expect(second.err).toContain("did not run again");
			}),
		),
	spawnLimit,
);

test(
	"a pass that printed more than a receipt keeps has no receipt",
	() =>
		run(
			Effect.gen(function* () {
				const { check, runs } = yield* world("long-output");
				const long = `echo run >> "$RUNS"; head -c 1100000 /dev/zero`;

				yield* check(long);

				const second = yield* check(long);
				const count = yield* runs;

				expect({ count, printed: second.out.length }).toEqual({ count: 2, printed: 1_100_000 });
			}),
		),
	spawnLimit,
);

test(
	"a second worktree of the same repo at the same tree gets the first one's receipt",
	() =>
		run(
			Effect.gen(function* () {
				const { repo, check, runs } = yield* world("worktrees");
				const other = `${repo}-worktree`;

				yield* spawned(["git", "worktree", "add", "-q", "--detach", other], {
					cwd: repo,
					home: `${scratch}/worktrees`,
				});
				yield* check(passing);

				const second = yield* check(passing, [], other);
				const count = yield* runs;

				expect(count).toBe(1);
				expect(second.err).toContain(`in ${repo}`);
			}),
		),
	spawnLimit,
);

test(
	"a clone with the same tree runs the check in its own folder",
	() =>
		run(
			Effect.gen(function* () {
				const { repo, check, runs } = yield* world("clones");
				const clone = `${repo}-clone`;

				yield* seeded(clone, `${scratch}/clones`);
				yield* check(passing);
				yield* check(passing, [], clone);

				const count = yield* runs;

				expect(count).toBe(2);
			}),
		),
	spawnLimit,
);

test(
	"check with no command after --, or with an option it does not know, prints its usage and exits 2",
	() =>
		run(
			Effect.gen(function* () {
				const { home, repo } = yield* world("usage");
				const calls = [[], ["--"], ["--bogus", "--", "true"]];
				const ran = yield* Effect.forEach(calls, (args) => spawned([checkBin, ...args], { cwd: repo, home }));

				expect(Arr.map(ran, ({ code, err }) => ({ code, err }))).toEqual(
					Arr.map(calls, () => ({ code: 2, err: "usage: check [--nice] [--fresh] -- <command>...\n" })),
				);
			}),
		),
	spawnLimit,
);

const slotHolders = (home: string, count: number) =>
	Effect.flatMap(FileSystem.FileSystem, (fs) => {
		const names = Effect.orElseSucceed(
			fs.readDirectory(`${home}/.local/state/pi-agent/queues/check-slots`),
			() => [],
		);

		return Effect.map(names, (found) => Arr.filter(found, Str.endsWith(".json")).length === count);
	});

test(
	"with PI_CHECK_SLOTS=1, a second check queues until the first one's slot frees",
	() =>
		run(
			Effect.gen(function* () {
				const { fs, home, repo } = yield* world("one-slot");
				const env = { PATH: path, HOME: home, PI_CHECK_SLOTS: "1" };

				const started = (script: string) =>
					Bun.spawn([checkBin, "--", "sh", "-c", script], { cwd: repo, env, stderr: "pipe" });

				const first = started('touch "$HOME/first-started"; while [ ! -f "$HOME/release" ]; do sleep 0.05; done');

				yield* eventually(fs.exists(`${home}/first-started`), "30 seconds");

				const second = started("echo second");

				yield* eventually(slotHolders(home, 2), "30 seconds");
				yield* fs.writeFileString(`${home}/release`, "");

				const said = yield* Effect.promise(() => new Response(second.stderr).text());

				yield* Effect.promise(() => first.exited);

				expect(said).toContain("check: queued, 1 ahead of this one");
			}),
		),
	spawnLimit,
);

test(
	"--nice runs the check 10 steps nicer than a plain one",
	() =>
		run(
			Effect.gen(function* () {
				const { check } = yield* world("nice");
				const plain = yield* check("nice", ["--fresh"]);
				const niced = yield* check("nice", ["--nice", "--fresh"]);

				expect(Number(niced.out)).toBe(Math.min(19, Number(plain.out) + 10));
			}),
		),
	spawnLimit,
);

test(
	"a receipt shows the command quoted so a shell reads back the same words",
	() =>
		run(
			Effect.gen(function* () {
				const { check } = yield* world("quoted");

				yield* check("echo 'a b'");

				const second = yield* check("echo 'a b'");

				expect(second.err).toContain("`sh -c 'echo '\\''a b'\\'''` passed on this tree");
			}),
		),
	spawnLimit,
);

test(
	"outside a git worktree a check runs every time and records no receipt",
	() =>
		run(
			Effect.gen(function* () {
				const { home, check, runs } = yield* world("outside");
				const first = yield* check(passing, [], home);

				yield* check(passing, [], home);

				const count = yield* runs;

				expect({ count, err: first.err }).toEqual({ count: 2, err: "" });
			}),
		),
	spawnLimit,
);
