import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

export interface StartedDelegate {
	readonly childSessionId: string;
	readonly name: string;
}

export interface Tally {
	readonly sessionStart: number;
	readonly usd: number;
	readonly started: ReadonlyArray<StartedDelegate>;
}

export const emptyTally: Tally = { sessionStart: Number.POSITIVE_INFINITY, usd: 0, started: [] };

const Priced = Schema.Struct({ cost: Schema.Struct({ total: Schema.Finite }) });

const DelegateStarted = Schema.Struct({
	type: Schema.Literal("delegate-started"),
	name: Schema.String,
	child_session_id: Schema.String,
});

/** Only the lines a tally reads, and only the fields it reads from them. */
const Line = Schema.Union([
	Schema.Struct({ type: Schema.Literal("session"), timestamp: Schema.String }),
	// A reply, or a tool result that called a model, carries its usage on the message.
	Schema.Struct({
		type: Schema.Literal("message"),
		timestamp: Schema.String,
		message: Schema.Struct({ usage: Priced }),
	}),
	Schema.Struct({
		type: Schema.Literals(["compaction", "branch_summary", "usage"]),
		timestamp: Schema.String,
		usage: Priced,
	}),
	Schema.Struct({
		type: Schema.Literal("custom"),
		customType: Schema.Literal("owned-work"),
		timestamp: Schema.String,
		data: DelegateStarted,
	}),
]);

type Line = typeof Line.Type;

const decodeLine = Schema.decodeOption(Schema.fromJsonString(Line));

const mayCount = (text: string) =>
	Str.startsWith('{"type":"session"')(text) ||
	Str.includes('"usage":')(text) ||
	Str.includes('"delegate-started"')(text);

const add = (tally: Tally, line: Line): Tally => {
	if (line.type === "session") {
		return { ...tally, sessionStart: Date.parse(line.timestamp) };
	}

	if (Date.parse(line.timestamp) < tally.sessionStart) {
		return tally;
	}

	if (line.type === "custom") {
		const { child_session_id: childSessionId, name } = line.data;

		return Arr.some(tally.started, (started) => started.childSessionId === childSessionId)
			? tally
			: { ...tally, started: [...tally.started, { childSessionId, name }] };
	}

	const { usage } = line.type === "message" ? line.message : line;

	return { ...tally, usd: tally.usd + usage.cost.total };
};

/** Adds whole JSONL lines to a tally. */
export const tallyLines = ({ tally, text }: { readonly tally: Tally; readonly text: string }): Tally => {
	const countable = Arr.filter(Str.split(text, "\n"), mayCount);

	return Arr.reduce(Arr.getSomes(Arr.map(countable, (line) => decodeLine(line))), tally, add);
};
