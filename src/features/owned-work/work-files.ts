import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { BriefSources } from "#src/client/brief-sources/index.ts";
import { BadDelegate } from "./work.ts";

const sharedDocumentAliases = [["GLOSSARY.md", "GLOSSARY-MAP.md"], ["CODING_STANDARDS.md"], ["docs/adr/"]];

/** The files a delegate's `<work>` names: the state folder's `STATE.md`, and the shared documents at the root of the git repo that holds `folder`, as far as they exist. */
export const workFilesOf = Effect.fn("workFilesOf")(
	function* (folder: string, state: Option.Option<string>) {
		const sources = yield* BriefSources;
		const firstFound = (paths: ReadonlyArray<string>) => Effect.findFirst(paths, (path) => sources.exists(path));
		const root = yield* sources.repoRoot(folder);

		const documents = Option.match(root, {
			onNone: () => [],
			onSome: (top) => Arr.map(sharedDocumentAliases, (names) => Arr.map(names, (name) => `${top}/${name}`)),
		});

		const stateFile = state.pipe(
			Option.map((own) => `${own}/STATE.md`),
			Option.toArray,
		);

		const destinationFile = yield* firstFound(stateFile);
		const found = yield* Effect.forEach(documents, firstFound);

		return { destinationFile, sharedDocuments: Arr.getSomes(found) };
	},
	Effect.mapError(({ path, why }) => BadDelegate.make({ why: `cannot read ${path}: ${why}` })),
);
