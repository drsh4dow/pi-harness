import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { agentFileText, type MarkdownFile, markdownIn } from "#src/client/pi/index.ts";
import { Role, Roles } from "#src/features/owned-work/index.ts";

export type Kind = "principles" | "playbooks";

const defaultRoles: Record<Kind, ReadonlyArray<Role>> = {
	principles: Role.literals,
	playbooks: ["root", "owner"],
};

const When = Schema.NonEmptyString.pipe(Schema.check(Schema.isPattern(/^[^\n<>]+$/u)));

const Frontmatter = Schema.Struct({
	when: When,
	for: Schema.optionalKey(Roles),
});

const decodeFrontmatter = Schema.decodeUnknownEffect(Frontmatter, { onExcessProperty: "error" });

const EntryName = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u)));

export interface Entry {
	readonly name: string;
	readonly when: string;
	readonly roles: ReadonlyArray<Role>;
}

export interface Problem {
	readonly file: string;
	readonly why: string;
}

const parseEntry = Effect.fn("parseEntry")(function* (kind: Kind, file: string, text: string) {
	const name = yield* Schema.decodeEffect(EntryName)(Str.replaceAll(/^.*\/|\.md$/gu, "")(file));
	const { frontmatter, body } = yield* Effect.try({ try: () => parseFrontmatter(text), catch: String });
	const fields = yield* decodeFrontmatter(frontmatter);

	if (Str.isEmpty(Str.trim(body))) {
		return yield* Effect.fail("the body is empty");
	}

	const entry: Entry = { name, when: fields.when, roles: fields.for ?? defaultRoles[kind] };

	return entry;
});

const byPath = Order.mapInput(Order.String, ({ path }: MarkdownFile) => path);

export const loadEntries = Effect.fn("loadEntries")(function* (kind: Kind, dir: string) {
	const listed = yield* markdownIn(dir);
	const files = Arr.sort(listed, byPath);

	const [entries, problems] = yield* Effect.partition(files, ({ path }) =>
		agentFileText(path).pipe(
			Effect.flatMap((text) => parseEntry(kind, path, text)),
			Effect.mapError((error): Problem => ({ file: path, why: String(error) })),
		),
	);

	return { entries, problems };
});

const line = ({ name, when }: Entry) => `- ${name}: ${when}`;

export const entryIndex = ({
	kind,
	role,
	dir,
	entries,
}: {
	kind: Kind;
	role: Role;
	dir: string;
	entries: ReadonlyArray<Entry>;
}) => {
	const fitting = Arr.filter(entries, (entry) => entry.roles.includes(role));

	return Arr.isReadonlyArrayNonEmpty(fitting)
		? Option.some(`<${kind} dir="${dir}">\n${Arr.join(Arr.map(fitting, line), "\n")}\n</${kind}>`)
		: Option.none();
};
