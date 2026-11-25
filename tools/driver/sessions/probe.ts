import {
	type BeforeProviderRequestEvent,
	type ExtensionAPI,
	type ExtensionContext,
	VERSION,
} from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

export const Loaded = Schema.Struct({
	version: Schema.String,
	model: Schema.TemplateLiteral([Schema.String, "/", Schema.String]),
	contextWindow: Schema.Finite,
	extensions: Schema.Array(Schema.String),
	settings: Schema.JsonObject,
	modelsError: Schema.OptionFromOptionalKey(Schema.String),
	socket: Schema.OptionFromOptionalKey(Schema.String),
});

export type Loaded = typeof Loaded.Type;

export const Probed = Schema.Union([
	Schema.Struct({ type: Schema.Literal("loaded"), session: Schema.String, ...Loaded.fields }),
	Schema.Struct({ type: Schema.Literal("request"), session: Schema.String, text: Schema.String }),
]);

export type Probed = typeof Probed.Type;

export const isJsonArray = Schema.is(Schema.Array(Schema.Json));

const leavesOf = (value: Schema.Json): ReadonlyArray<string> => {
	if (Predicate.isString(value)) {
		return [value];
	}

	if (isJsonArray(value)) {
		return Arr.flatMap(value, leavesOf);
	}

	if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
		return [];
	}

	return Arr.flatMap(Rec.values(value), leavesOf);
};

export const textOf = (payload: Schema.Json): string => Arr.join(leavesOf(payload), "\n");

const target = Config.option(Config.String("PI_DRIVER_PROBE"));

const encodeLine = Schema.encodeEffect(Schema.fromJsonString(Probed));

const asJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const encodePayload = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const asJsonObject = Schema.decodeUnknownEffect(Schema.JsonObject);

const record = (line: Probed) =>
	Effect.gen(function* () {
		const folder = yield* target;

		if (Option.isNone(folder)) {
			return;
		}

		const fs = yield* FileSystem.FileSystem;
		const json = yield* encodeLine(line);

		yield* fs.writeFileString(`${folder.value}/${String(process.pid)}.jsonl`, `${json}\n`, { flag: "a" });
	});

const extensionFilesOf = (pi: ExtensionAPI) => {
	const tools = Arr.map(pi.getAllTools(), (tool) => tool.sourceInfo.path);
	const commands = Arr.filter(pi.getCommands(), (command) => command.source === "extension");

	return Arr.filter([...tools, ...Arr.map(commands, (command) => command.sourceInfo.path)], Str.startsWith("/"));
};

const loaded = (pi: ExtensionAPI, ctx: ExtensionContext) =>
	Effect.gen(function* () {
		const { model } = ctx;

		if (model === undefined) {
			return;
		}

		const fs = yield* FileSystem.FileSystem;
		const extensions = yield* Effect.forEach(extensionFilesOf(pi), (file) => fs.realPath(file));
		const settings = yield* asJsonObject(pi.getSettings());
		const socket = yield* Config.option(Config.String("HC_TERMINAL_SOCKET"));

		yield* record({
			type: "loaded",
			session: ctx.sessionManager.getSessionId(),
			version: VERSION,
			model: `${model.provider}/${model.id}`,
			contextWindow: model.contextWindow,
			extensions: Arr.sort(Arr.dedupe(extensions), Order.String),
			settings,
			modelsError: Option.fromUndefinedOr(ctx.modelRegistry.getError()),
			socket,
		});
	});

const sent = (event: BeforeProviderRequestEvent, ctx: ExtensionContext) =>
	Effect.gen(function* () {
		const json = yield* Effect.flatMap(encodePayload(event.payload), asJson);

		yield* record({ type: "request", session: ctx.sessionManager.getSessionId(), text: textOf(json) });
	});

const run = <Failure>(effect: Effect.Effect<void, Failure, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(effect, NodeServices.layer));

export default function probeExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => run(loaded(pi, ctx)));
	pi.on("agent_start", (_event, ctx) => run(loaded(pi, ctx)));
	pi.on("before_provider_request", (event, ctx) => run(sent(event, ctx)));
}
