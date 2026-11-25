import type { AssistantMessage, SystemMessage, Usage } from "@earendil-works/pi-ai";
import type {
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";

export const entryKind = "pi.cache-miss";

export const cacheTtlMs = 5 * 60 * 1000;

const minMissedTokens = 50_000;

export const Cause = Schema.TaggedUnion({
	Idle: { ms: Schema.Finite },
	ModelChanged: { from: Schema.String, to: Schema.String },
	Compacted: {},
	ContextEdited: {},
	PromptChanged: {},
	ToolsChanged: {},
});

export type Cause = typeof Cause.Type;

export const Miss = Schema.Struct({
	missedTokens: Schema.Finite,
	cacheRead: Schema.Finite,
	prompt: Schema.Finite,
	causes: Schema.Array(Cause),
});

export type Miss = typeof Miss.Type;

interface Call {
	readonly at: number;
	readonly model: string;
	readonly usage: Usage;
}

const promptOf = (usage: Usage) => usage.input + usage.cacheRead + usage.cacheWrite;

const usedCache = (usage: Usage) => usage.cacheRead + usage.cacheWrite > 0;

const reachedModel = (usage: Usage) => promptOf(usage) > 0;

const callOf = (entry: SessionEntry): Option.Option<Call> => {
	if (entry.type === "message" && entry.message.role === "assistant" && reachedModel(entry.message.usage)) {
		const { timestamp, provider, model, usage } = entry.message;

		return Option.some({ at: timestamp, model: `${provider}/${model}`, usage });
	}

	if (entry.type === "usage" && entry.kind === "cache_warm" && reachedModel(entry.usage)) {
		const { timestamp, provider, model, usage } = entry;

		return Option.some({ at: Date.parse(timestamp), model: `${provider}/${model}`, usage });
	}

	return Option.none();
};

interface Last {
	readonly call: Call;
	readonly since: ReadonlyArray<SessionEntry>;
}

const lastCall = (branch: ReadonlyArray<SessionEntry>): Option.Option<Last> =>
	Arr.findLast(branch, (entry, index) =>
		Option.map(callOf(entry), (call) => ({ call, since: branch.slice(index + 1) })),
	);

const systemMessages = (entries: ReadonlyArray<SessionEntry>): ReadonlyArray<SystemMessage> =>
	Arr.getSomes(
		Arr.map(entries, (entry) =>
			entry.type === "message" && entry.message.role === "system" ? Option.some(entry.message) : Option.none(),
		),
	);

const changesPrompt = ({ content, sections }: SystemMessage) =>
	content.length > 0 || !Rec.isEmptyRecord(sections ?? {});

const changesTools = ({ toolsAdded, toolsRemoved }: SystemMessage) =>
	Arr.isReadonlyArrayNonEmpty(toolsAdded ?? []) || Arr.isReadonlyArrayNonEmpty(toolsRemoved ?? []);

const isToolDeclaration = Schema.is(Schema.Struct({ name: Schema.String, description: Schema.String }));

const encodeBody = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

const isJsonArray = (json: Schema.Json): json is Schema.JsonArray => Arr.isArray(json);

const isJsonObject = (json: Schema.Json): json is Schema.JsonObject => Predicate.isObject(json);

const toolDeclarations = (json: Schema.Json): ReadonlyArray<Schema.Json> => {
	if (isJsonArray(json)) {
		return Arr.flatMap(json, toolDeclarations);
	}

	if (!isJsonObject(json)) {
		return [];
	}

	return isToolDeclaration(json) ? [json] : Arr.flatMap(Rec.values(json), toolDeclarations);
};

interface RequestHead {
	readonly prompt: string;
	readonly tools: ReadonlyArray<Schema.Json>;
}

interface HeadChange {
	readonly prompt: boolean;
	readonly tools: boolean;
}

const headChange = (before: Option.Option<RequestHead>, after: Option.Option<RequestHead>): HeadChange =>
	Option.getOrElse(
		Option.zipWith(before, after, (from, to) => ({
			prompt: from.prompt !== to.prompt,
			tools: !Equal.equals(from.tools, to.tools),
		})),
		() => ({ prompt: false, tools: false }),
	);

const causesOf = (reply: AssistantMessage, { call, since }: Last, head: HeadChange) => {
	const idleMs = reply.timestamp - call.at;
	const model = `${reply.provider}/${reply.model}`;
	const changes = systemMessages(since);
	const { cases } = Cause;

	const held: ReadonlyArray<readonly [boolean, Cause]> = [
		[idleMs > cacheTtlMs, cases.Idle.make({ ms: idleMs })],
		[model !== call.model, cases.ModelChanged.make({ from: call.model, to: model })],
		[Arr.some(since, (entry) => entry.type === "compaction"), cases.Compacted.make({})],
		[Arr.some(since, (entry) => entry.type === "context_edit"), cases.ContextEdited.make({})],
		[head.prompt || Arr.some(changes, changesPrompt), cases.PromptChanged.make({})],
		[head.tools || Arr.some(changes, changesTools), cases.ToolsChanged.make({})],
	];

	return Arr.map(
		Arr.filter(held, ([holds]) => holds),
		([, cause]) => cause,
	);
};

const missOf = (
	branch: ReadonlyArray<SessionEntry>,
	reply: AssistantMessage,
	head: HeadChange,
): Option.Option<Miss> => {
	const { cacheRead } = reply.usage;
	const prompt = promptOf(reply.usage);

	const providerCaches =
		usedCache(reply.usage) ||
		Arr.some(branch, (entry) => Option.exists(callOf(entry), ({ usage }) => usedCache(usage)));

	return Option.flatMap(lastCall(branch), (last) => {
		const missedTokens = Math.min(promptOf(last.call.usage), prompt) - cacheRead;

		if (!providerCaches || missedTokens < minMissedTokens) {
			return Option.none();
		}

		return Option.some({ missedTokens, cacheRead, prompt, causes: causesOf(reply, last, head) });
	});
};

export const recordMisses = (pi: Pick<ExtensionAPI, "appendEntry">) => {
	let sending = Option.none<RequestHead>();
	let answered = Option.none<RequestHead>();

	const request = ({ payload }: BeforeProviderRequestEvent, ctx: Pick<ExtensionContext, "getSystemPrompt">) => {
		const body = Option.flatMap(encodeBody(payload), decodeBody);

		sending = Option.some({
			prompt: ctx.getSystemPrompt(),
			tools: Option.getOrElse(Option.map(body, toolDeclarations), () => []),
		});
	};

	const reply = ({ message }: MessageEndEvent, ctx: Pick<ExtensionContext, "sessionManager">) => {
		if (message.role !== "assistant") {
			return;
		}

		const miss = missOf(ctx.sessionManager.getBranch(), message, headChange(answered, sending));

		if (reachedModel(message.usage)) {
			answered = sending;
		}

		if (Option.isSome(miss)) {
			pi.appendEntry(entryKind, miss.value);
		}
	};

	return { request, reply };
};

export const cache = (pi: Pick<ExtensionAPI, "on" | "appendEntry">) => {
	const misses = recordMisses(pi);

	pi.on("before_provider_request", misses.request);
	pi.on("message_end", misses.reply);
};
