import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
	createGrepToolDefinition,
	createReadToolDefinition,
	defineTool,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { type Static, Type } from "typebox";

import { piHost } from "#src/client/pi-host/index.ts";

const Range = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

type Range = Static<typeof Range>;

const ReadParams = Type.Object({
	path: Type.Optional(Range.properties.path),
	offset: Range.properties.offset,
	limit: Range.properties.limit,
	paths: Type.Optional(
		Type.Array(Range, {
			description: "Several files or line ranges to read in this one call, each with its own offset and limit",
		}),
	),
});

const rangesOf = ({ paths = [], ...first }: Static<typeof ReadParams>): ReadonlyArray<Range> =>
	first.path === undefined || first.path === "" ? paths : [{ ...first, path: first.path }, ...paths];

const textOf = (part: TextContent | ImageContent) => (part.type === "text" ? [part.text] : []);

const readTool = (cwd: string) => {
	const { renderCall: _call, renderResult: _result, ...read } = createReadToolDefinition(cwd);
	const host = piHost(Layer.empty);

	return defineTool({
		...read,
		description: `${read.description} Pass \`paths\` to read several files or line ranges in one call.`,
		promptGuidelines: [
			...(read.promptGuidelines ?? []),
			"Use read with `paths` to read several files or line ranges in one call, not one read per turn.",
		],
		parameters: ReadParams,
		execute: (id, params, signal, onUpdate, ctx) => {
			const ranges = rangesOf(params);
			const readOne = (range: Range) => read.execute(id, range, signal, onUpdate, ctx);
			const [only, ...rest] = ranges;

			if (only === undefined) {
				return Promise.reject(new Error("read needs a path or paths"));
			}

			if (rest.length === 0) {
				return readOne(only);
			}

			const section = (range: Range) =>
				Effect.tryPromise({
					try: () => readOne(range),
					catch: (error) => (error instanceof Error ? error.message : String(error)),
				}).pipe(
					Effect.match({
						onFailure: (message): ReadonlyArray<TextContent | ImageContent> => [{ type: "text", text: message }],
						onSuccess: ({ content }) => content,
					}),
					Effect.map((content) => [{ type: "text" as const, text: `==> ${range.path} <==` }, ...content]),
				);

			const sections = Effect.map(Effect.forEach(ranges, section, { concurrency: "unbounded" }), (all) => {
				const content = Arr.flatten(all);

				return { content, details: undefined, structuredContent: Arr.join(Arr.flatMap(content, textOf), "\n") };
			});

			return host.run(sections, { signal });
		},
	});
};

const grepTool = (cwd: string) => ({
	...createGrepToolDefinition(cwd),
	promptGuidelines: [
		"Use grep with `context` to see each match with the lines around it, not a bash grep and then a read of those lines.",
	],
});

export const navigation = (cwd: string) => (pi: Pick<ExtensionAPI, "registerTool">) => {
	pi.registerTool(readTool(cwd));
	pi.registerTool(grepTool(cwd));
};
