import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Str from "effect/String";

export interface MarkdownFile {
	readonly name: string;
	readonly path: string;
}

export const agentFileText = Effect.fn("agentFileText")(function* (path: string) {
	const fs = yield* FileSystem.FileSystem;

	return yield* fs.readFileString(path);
});

export const markdownIn = Effect.fn("markdownIn")(function* (dir: string) {
	const fs = yield* FileSystem.FileSystem;
	const names = (yield* fs.exists(dir)) ? yield* fs.readDirectory(dir) : [];

	return Arr.map(Arr.filter(names, Str.endsWith(".md")), (name): MarkdownFile => ({
		name: Str.slice(0, -3)(name),
		path: `${dir}/${name}`,
	}));
});
