import { parseSessionEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as Struct from "effect/Struct";

import { ScenarioFailed } from "#tools/driver/failed.ts";
import { type Loaded, Probed } from "./probe.ts";

export interface Session {
	readonly id: string;
	readonly file: string;
	readonly entries: ReadonlyArray<SessionEntry>;
	readonly loaded: Option.Option<Loaded>;
	readonly requests: ReadonlyArray<string>;
}

export interface Sessions {
	readonly root: Session;
	readonly delegates: ReadonlyArray<Session>;
}

const completeLines = (text: string) =>
	Option.match(Str.lastIndexOf("\n")(text), { onNone: () => "", onSome: (last) => Str.slice(0, last + 1)(text) });

const decodeProbed = Schema.decodeUnknownOption(Schema.fromJsonString(Probed));

const probedIn = (text: string): ReadonlyArray<Probed> => {
	const lines = Str.split(completeLines(text), "\n");

	return Arr.getSomes(Arr.map(lines, (line) => decodeProbed(line)));
};

const probedOf = (id: string, probed: ReadonlyArray<Probed>) => {
	const mine = Arr.filter(probed, (record) => record.session === id);

	return {
		loaded: Option.map(
			Arr.findLast(mine, (record) => record.type === "loaded"),
			Struct.omit(["type", "session"]),
		),
		requests: Arr.flatMap(mine, (record) => (record.type === "request" ? [record.text] : [])),
	};
};

const isEntry = (entry: ReturnType<typeof parseSessionEntries>[number]): entry is SessionEntry =>
	entry.type !== "session";

const sessionIn = ({
	file,
	text,
	probed,
}: {
	readonly file: string;
	readonly text: string;
	readonly probed: ReadonlyArray<Probed>;
}): Option.Option<Session> => {
	const entries = parseSessionEntries(completeLines(text));
	const [header] = entries;

	if (header?.type !== "session") {
		return Option.none();
	}

	return Option.some({ id: header.id, file, entries: Arr.filter(entries, isEntry), ...probedOf(header.id, probed) });
};

const byName = Order.mapInput(Order.String, (file: string) => Str.replace(/^.*\//u, "")(file));

export const readSessions = ({
	root,
	sessionDir,
	probeDir,
}: {
	readonly root: { readonly id: string; readonly file: string };
	readonly sessionDir: string;
	readonly probeDir: string;
}): Effect.Effect<Sessions, ScenarioFailed, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;

		const jsonlIn = (folder: string) =>
			fs.exists(folder).pipe(
				Effect.flatMap((exists) => (exists ? fs.readDirectory(folder, { recursive: true }) : Effect.succeed([]))),
				Effect.map((names) => Arr.map(Arr.filter(names, Str.endsWith(".jsonl")), (name) => `${folder}/${name}`)),
			);

		const textOf = (file: string) =>
			Effect.flatMap(fs.exists(file), (exists) => (exists ? fs.readFileString(file) : Effect.succeed("")));

		const probeFiles = yield* jsonlIn(probeDir);
		const probeTexts = yield* Effect.forEach(probeFiles, textOf);
		const probed = Arr.flatMap(probeTexts, probedIn);
		const rootText = yield* textOf(root.file);
		const delegateFiles = yield* jsonlIn(`${sessionDir}/delegates`);

		const delegates = yield* Effect.forEach(Arr.sort(delegateFiles, byName), (file) =>
			Effect.map(textOf(file), (text) => sessionIn({ file, text, probed })),
		);

		return {
			root: Option.getOrElse(sessionIn({ file: root.file, text: rootText, probed }), () => ({
				...root,
				entries: [],
				...probedOf(root.id, probed),
			})),
			delegates: Arr.getSomes(delegates),
		};
	}).pipe(
		Effect.mapError((error) => ScenarioFailed.make({ message: `cannot read the run's sessions: ${error.message}` })),
	);
