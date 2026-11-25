import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

class SourceRefused extends Schema.TaggedError<SourceRefused, { readonly brand: unique symbol }>()("SourceRefused", {
	path: Schema.String,
	why: Schema.Literals([
		"AlreadyExists",
		"BadArgument",
		"BadResource",
		"Busy",
		"InvalidData",
		"NotFound",
		"PermissionDenied",
		"TimedOut",
		"UnexpectedEof",
		"Unknown",
		"WouldBlock",
		"WriteZero",
		"not a folder",
	]),
}) {}

export class BriefSources extends Context.Service<
	BriefSources,
	{
		readonly read: (file: string) => Effect.Effect<string, SourceRefused>;
		/** None when the file does not exist. */
		readonly readIfPresent: (file: string) => Effect.Effect<Option.Option<string>, SourceRefused>;
		readonly exists: (path: string) => Effect.Effect<boolean, SourceRefused>;
		readonly list: (folder: string) => Effect.Effect<ReadonlyArray<string>, SourceRefused>;
		/** The nearest folder at or above `folder` that holds a `.git`, or None outside a git repo. */
		readonly repoRoot: (folder: string) => Effect.Effect<Option.Option<string>, SourceRefused>;
		/** The real path of `folder`, which must exist and be a folder. */
		readonly realFolder: (folder: string) => Effect.Effect<string, SourceRefused>;
	}
>()("pi-harness/client/brief-sources/BriefSources") {}

const refused = (path: string, error: PlatformError.PlatformError): SourceRefused =>
	SourceRefused.make({ path, why: error.reason._tag });

export const briefSourcesLayer: Layer.Layer<BriefSources, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
	BriefSources,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const exists = (file: string) => Effect.mapError(fs.exists(file), (error) => refused(file, error));

		const repoRoot = (folder: string): Effect.Effect<Option.Option<string>, SourceRefused> =>
			Effect.flatMap(exists(path.join(folder, ".git")), (found) => {
				const parent = path.dirname(folder);

				if (found) {
					return Effect.succeedSome(folder);
				}

				return parent === folder ? Effect.succeedNone : repoRoot(parent);
			});

		return BriefSources.of({
			read: (file) => Effect.mapError(fs.readFileString(file), (error) => refused(file, error)),
			readIfPresent: (file) =>
				fs.readFileString(file).pipe(
					Effect.asSome,
					Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
					Effect.mapError((error) => refused(file, error)),
				),
			exists,
			list: (folder) => Effect.mapError(fs.readDirectory(folder), (error) => refused(folder, error)),
			repoRoot,
			realFolder: (folder) =>
				Effect.gen(function* () {
					const real = yield* Effect.mapError(fs.realPath(folder), (error) => refused(folder, error));
					const info = yield* Effect.mapError(fs.stat(real), (error) => refused(folder, error));

					return info.type === "Directory"
						? real
						: yield* SourceRefused.make({ path: folder, why: "not a folder" });
				}),
		});
	}),
);
