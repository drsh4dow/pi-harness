import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";

/**
 * Where a check ran: the repository's shared git folder, the worktree's root, the folder inside it, and the tree it
 * would commit with every file added.
 */
export interface Worktree {
	readonly repo: string;
	readonly root: string;
	readonly prefix: string;
	readonly tree: string;
}

const outcome = (handle: ChildProcessSpawner.ChildProcessHandle) =>
	Effect.all(
		{ code: handle.exitCode, stdout: handle.stdout.pipe(Stream.decodeText, Stream.mkString) },
		{ concurrency: 2 },
	);

const git = (args: ReadonlyArray<string>, at: { readonly cwd: string; readonly index?: string }) =>
	Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) => {
		const env = at.index === undefined ? {} : { GIT_INDEX_FILE: at.index };
		const command = ChildProcess.make("git", args, { cwd: at.cwd, env, extendEnv: true, stderr: "ignore" });

		return spawner.spawn(command).pipe(
			Effect.flatMap(outcome),
			Effect.scoped,
			Effect.map(({ code, stdout }) => (code === 0 ? Option.some(stdout) : Option.none())),
		);
	});

/** A copy of the worktree's index in a folder that lives as long as the scope. A worktree without an index gets none. */
const indexCopy = (index: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const folder = yield* fs.makeTempDirectoryScoped();
		const copy = `${folder}/index`;
		const exists = yield* fs.exists(index);

		if (exists) {
			yield* fs.copyFile(index, copy);
		}

		return copy;
	});

const treeOf = ({ root, index }: { readonly root: string; readonly index: string }) =>
	Effect.gen(function* () {
		const copy = yield* indexCopy(index);
		const added = yield* git(["add", "--all"], { cwd: root, index: copy });

		if (Option.isNone(added)) {
			return Option.none();
		}

		const written = yield* git(["write-tree"], { cwd: root, index: copy });

		return Option.map(written, Str.trim);
	});

const locate = [
	"rev-parse",
	"--path-format=absolute",
	"--show-toplevel",
	"--show-prefix",
	"--git-path",
	"index",
	"--git-common-dir",
];

/**
 * The tree of the worktree at `cwd` with every tracked, modified and untracked file added, and ignored files left out.
 * It adds them to a copy of the worktree's index, so the real index stays as it was. None outside a git worktree.
 */
export const worktreeAt = (
	cwd: string,
): Effect.Effect<
	Option.Option<Worktree>,
	PlatformError.PlatformError,
	ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
	Effect.scoped(
		Effect.gen(function* () {
			const found = yield* git(locate, { cwd });

			if (Option.isNone(found)) {
				return Option.none();
			}

			const [root, prefix = "", index = "", repo = ""] = Str.split(found.value, "\n");

			const tree = yield* treeOf({ root, index });

			return Option.map(tree, (written) => ({ repo, root, prefix, tree: written }));
		}),
	);
