import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolCallEvent,
	ToolExecutionEndEvent,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { piHost } from "#src/client/pi/index.ts";
import { type Fingerprint, StateFolder, stateFolderLayer } from "#src/client/state-folder/index.ts";
import { labelTerminal, TerminalAddress } from "#src/client/terminals/index.ts";
import type { FormatProblem } from "./action-items.ts";
import { checks, type Place } from "./checks.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const labelKey = "pi.state";

export const entryKind = "pi.state";

const StateEntry = Schema.Struct({
	type: Schema.Literal("custom"),
	customType: Schema.Literal(entryKind),
	data: Schema.Struct({ folder: Schema.String }),
});

const decodeEntry = Schema.decodeUnknownOption(StateEntry);
const encodeInput = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const statePath = "/.local/state/pi-agent/";
const segment = "[^/\\s\"'`$\\\\;|&<>()*?{}]+";
const escaped = Str.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

const foldersIn = ({ home, input }: { readonly home: string; readonly input: string }): ReadonlyArray<string> => {
	const homes = Arr.join([escaped(home), "~", String.raw`\$HOME`, String.raw`\$\{HOME\}`], "|");
	const pattern = new RegExp(`(?:${homes})${escaped(statePath)}(${segment}/${segment})`, "gu");
	const named = Arr.getSomes(Arr.map([...Str.matchAll(pattern)(input)], (match) => Option.fromNullishOr(match[1])));

	return Arr.dedupe(Arr.map(named, (folder) => `${home}${statePath}${folder}`));
};

export type Watched = Map<ToolCallEvent["toolCallId"], ReadonlyArray<readonly [folder: string, before: Fingerprint]>>;

export const watchCall = Effect.fn("watchCall")(function* (
	watched: Watched,
	{ home, toolCallId, input }: { readonly home: string; readonly toolCallId: string; readonly input: string },
) {
	const stateFolder = yield* StateFolder;

	const seen = yield* Effect.forEach(foldersIn({ home, input }), (folder) =>
		Effect.map(stateFolder.fingerprint(folder), (before) => [folder, before] as const),
	);

	if (seen.length > 0) {
		watched.set(toolCallId, seen);
	}
});

const changedNames = (before: Fingerprint, after: Fingerprint) =>
	Arr.filter(Arr.dedupe([...before.keys(), ...after.keys()]), (name) => before.get(name) !== after.get(name));

const byLine = Order.mapInput(Order.Number, ({ line }: FormatProblem) => line);

const reportOn = Effect.fn("reportOn")(function* (place: Place, name: string) {
	const stateFolder = yield* StateFolder;
	const path = `${place.folder}/${name}`;
	const check = checks.get(name);

	if (check === undefined) {
		return Option.none<string>();
	}

	const file = yield* Effect.option(stateFolder.bytes(path));

	if (Option.isNone(file)) {
		return Option.none<string>();
	}

	const problems = yield* check.problems(file.value, place);

	return Arr.match(Arr.sort(problems, byLine), {
		onEmpty: () => Option.none<string>(),
		onNonEmpty: (found) =>
			Option.some(
				Arr.join(
					[
						`${path} changed on disk, so the call went through, but the file breaks its rules. Fix the file rather than redo the call.`,
						...Arr.map(found, ({ line, message }) => `line ${String(line)}: ${message}`),
						check.fix,
					],
					"\n",
				),
			),
	});
});

export const finishCall = Effect.fn("finishCall")(function* (
	watched: Watched,
	{ home, result }: { readonly home: string; readonly result: Pick<ToolResultEvent, "toolCallId" | "content"> },
) {
	const stateFolder = yield* StateFolder;
	const seen = watched.get(result.toolCallId) ?? [];

	watched.delete(result.toolCallId);

	const changes = yield* Effect.forEach(seen, ([folder, before]) =>
		Effect.map(stateFolder.fingerprint(folder), (after) => ({ folder, names: changedNames(before, after) })),
	);

	const changed = Arr.filter(changes, ({ names }) => names.length > 0);

	const reports = yield* Effect.forEach(changed, ({ folder, names }) =>
		Effect.forEach(names, (name) => reportOn({ home, folder }, name)),
	);

	const checked = Arr.match(Arr.getSomes(Arr.flatten(reports)), {
		onEmpty: () => Option.none<ToolResultEventResult>(),
		onNonEmpty: (found) =>
			Option.some<ToolResultEventResult>({
				content: [...result.content, { type: "text", text: Arr.join(found, "\n\n") }],
				isError: true,
			}),
	});

	return { wrote: Option.map(Arr.last(changed), ({ folder }) => folder), checked };
});

export const lastFolder = (branch: ReadonlyArray<SessionEntry>): Option.Option<string> => {
	const recorded = Arr.getSomes(Arr.map(branch, (entry) => decodeEntry(entry)));

	return Option.map(Arr.last(recorded), ({ data }) => data.folder);
};

const ownTerminal = Effect.map(Effect.option(Config.String("HC_TERMINAL_ID")), Option.map(TerminalAddress));

interface Tracker {
	readonly watched: Watched;
	lastWritten: Option.Option<string>;
	publishedLabel: string;
}

const publish = Effect.fn("publish")(function* (tracker: Tracker) {
	const terminal = yield* ownTerminal;
	const text = Option.getOrElse(tracker.lastWritten, () => "");

	if (Option.isSome(terminal) && text !== tracker.publishedLabel) {
		yield* labelTerminal({ terminal: terminal.value, labels: { [labelKey]: text } });
		tracker.publishedLabel = text;
	}
});

const watch = Effect.fn("watch")(function* (tracker: Tracker, { toolCallId, input }: ToolCallEvent) {
	const home = yield* Config.String("HOME");
	const text = yield* encodeInput(input);

	yield* watchCall(tracker.watched, { home, toolCallId, input: text });
});

const finish = Effect.fn("finish")(function* (
	tracker: Tracker,
	{ pi, result }: { readonly pi: Pick<ExtensionAPI, "appendEntry">; readonly result: ToolResultEvent },
) {
	const home = yield* Config.String("HOME");
	const { wrote, checked } = yield* finishCall(tracker.watched, { home, result });

	if (Option.isSome(wrote) && !Option.contains(tracker.lastWritten, wrote.value)) {
		tracker.lastWritten = wrote;
		pi.appendEntry(entryKind, { folder: wrote.value });
		yield* publish(tracker).pipe(Effect.catchCause((cause) => Effect.logWarning(cause)));
	}

	return Option.getOrUndefined(checked);
});

export const stateFolder = (env: Env) => (pi: Pick<ExtensionAPI, "appendEntry">) => {
	const tracker: Tracker = { watched: new Map(), lastWritten: Option.none(), publishedLabel: "" };
	const config = ConfigProvider.layer(ConfigProvider.fromEnvRecord(env));
	const host = piHost(Layer.provide(Layer.merge(stateFolderLayer, config), NodeServices.layer));

	const run = <Value, Failure>(effect: Effect.Effect<Value, Failure, StateFolder>) =>
		host.run(Effect.catchCause(effect, (cause) => Effect.logWarning(cause)));

	return {
		restore: (ctx: Pick<ExtensionContext, "sessionManager">) => {
			tracker.lastWritten = lastFolder(ctx.sessionManager.getBranch());

			return run(publish(tracker));
		},
		toolCall: (event: ToolCallEvent) => run(watch(tracker, event)),
		toolResult: (result: ToolResultEvent) => run(finish(tracker, { pi, result })),
		endWatch: ({ toolCallId }: Pick<ToolExecutionEndEvent, "toolCallId">) => {
			tracker.watched.delete(toolCallId);
		},
		shutdown: () => {
			tracker.lastWritten = Option.none();

			return run(publish(tracker));
		},
	};
};
