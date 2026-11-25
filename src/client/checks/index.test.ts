import { expect, test } from "bun:test";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Str from "effect/String";

import { git } from "#src/client/git/index.ts";
import { eventually } from "#src/primitives/eventually.ts";
import { scratchFolder } from "#src/primitives/scratch.fixture.ts";
import { type Receipt, receiptOf, recordReceipt, worktreeAt } from "./index.ts";

const scratch = scratchFolder("checks-client-test");

const run = <Value, Failure>(
	body: Effect.Effect<Value, Failure, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner>,
) => Effect.runPromise(Effect.provide(body, NodeServices.layer));

const receipt = (stdout: string): Receipt => ({
	command: ["true"],
	repo: `${scratch}/repo/.git`,
	root: `${scratch}/repo`,
	prefix: "",
	tree: "tree",
	passedAt: "2026-01-01T00:00:00.000Z",
	seconds: 1,
	stdout,
	stderr: "",
});

test("a receipt file that does not read as a receipt reads as none, like a missing one", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = `${scratch}/undecodable`;

			yield* fs.makeDirectory(folder, { recursive: true });
			yield* fs.writeFileString(`${folder}/broken.json`, '{"command":');

			const broken = yield* receiptOf(folder)("broken");
			const missing = yield* receiptOf(folder)("missing");

			expect({ broken, missing }).toEqual({ broken: Option.none(), missing: Option.none() });
		}),
	));

const stopsHalfway = (fs: FileSystem.FileSystem): FileSystem.FileSystem => ({
	...fs,
	writeFileString: (path, data, options) =>
		Effect.andThen(fs.writeFileString(path, Str.slice(0, data.length / 2)(data), options), Effect.die("stopped")),
});

test("a receipt write that stops halfway leaves the receipt before it whole", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const folder = `${scratch}/halfway`;

			const second = recordReceipt(folder)("key", receipt("second\n"));

			yield* recordReceipt(folder)("key", receipt("first\n"));
			yield* Effect.exit(Effect.provideService(second, FileSystem.FileSystem, stopsHalfway(fs)));

			const kept = yield* receiptOf(folder)("key");

			expect(kept).toEqual(Option.some(receipt("first\n")));
		}),
	));

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const inOwnGroup = (home: string, script: string) =>
	Bun.spawn(["setsid", `${import.meta.dirname}/../../../agent/bin/queue`, "group", "--", "sh", "-c", script], {
		cwd: home,
		env: { PATH: Bun.env["PATH"] ?? "", HOME: home },
	});

test(
	"a kill sent to the caller's process group stops the command it runs",
	() =>
		run(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = `${scratch}/group`;
				const script = "echo $$ > command.tmp && mv command.tmp command.pid && exec sleep 60";

				yield* fs.makeDirectory(home, { recursive: true });

				const caller = inOwnGroup(home, script);

				yield* eventually(fs.exists(`${home}/command.pid`), "30 seconds");

				const written = yield* fs.readFileString(`${home}/command.pid`);
				const pid = Number(Str.trim(written));

				process.kill(-caller.pid, "SIGKILL");

				yield* eventually(
					Effect.sync(() => !isAlive(pid)),
					"10 seconds",
				);
			}),
		),
	{ timeout: 60_000 },
);

const gitIn = (repo: string, ...args: ReadonlyArray<string>) =>
	git({ args: ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args] });

const addedTree = (repo: string) =>
	Effect.andThen(gitIn(repo, "add", "--all"), Effect.map(gitIn(repo, "write-tree"), Str.trim));

test("a worktree whose repository has no index yet still has the tree of its files", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const repo = `${scratch}/no-index`;

			yield* fs.makeDirectory(repo, { recursive: true });
			yield* gitIn(repo, "init", "-q");
			yield* fs.writeFileString(`${repo}/a.txt`, "a\n");

			const found = yield* worktreeAt(repo);
			const expected = yield* addedTree(repo);

			expect(Option.map(found, ({ tree }) => tree)).toEqual(Option.some(expected));
		}),
	));

test("a worktree's tree adds untracked and edited files, leaves out ignored ones, and keeps the real index", () =>
	run(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const repo = `${scratch}/edited`;

			yield* fs.makeDirectory(repo, { recursive: true });
			yield* gitIn(repo, "init", "-q");
			yield* fs.writeFileString(`${repo}/.gitignore`, "ignored.txt\n");
			yield* fs.writeFileString(`${repo}/a.txt`, "a\n");
			yield* gitIn(repo, "add", "--all");
			yield* gitIn(repo, "commit", "-qm", "a");
			yield* fs.writeFileString(`${repo}/a.txt`, "a\nmore\n");
			yield* fs.writeFileString(`${repo}/new.txt`, "new\n");
			yield* fs.writeFileString(`${repo}/ignored.txt`, "ignored\n");

			const found = yield* worktreeAt(repo);
			const status = yield* gitIn(repo, "status", "--porcelain");
			const expected = yield* addedTree(repo);
			const files = yield* gitIn(repo, "ls-tree", "--name-only", expected);

			expect(status).toBe(" M a.txt\n?? new.txt\n");
			expect(Option.map(found, ({ tree }) => tree)).toEqual(Option.some(expected));
			expect(files).toBe(".gitignore\na.txt\nnew.txt\n");
		}),
	));
