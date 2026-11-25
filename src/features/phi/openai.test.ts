import { expect, test } from "bun:test";

import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Type } from "typebox";

import { Reply } from "./anthropic.fixture.ts";
import { type MockOpenAi, serveOpenAi } from "./openai.fixture.ts";

const lookup = { query: "weather in Lisbon", limit: 3 };

const ssn = "123-45-6789";

const reply = ({ lastText }: { readonly lastText: string }) =>
	lastText === "use the tool"
		? Reply.ToolUse({ before: Option.some("Looking it up."), name: "lookup", input: lookup })
		: Reply.Text({ text: `you said: ${lastText}` });

const tools = [
	{
		name: "lookup",
		description: "Looks a query up.",
		parameters: Type.Object({ query: Type.String(), limit: Type.Number() }),
	},
];

const withMock = <Value, Failure>(use: (mock: MockOpenAi) => Effect.Effect<Value, Failure, HttpClient.HttpClient>) =>
	Effect.runPromise(
		Effect.acquireUseRelease(
			Effect.sync(() => serveOpenAi({ reply, sealed: Str.includes(ssn) })),
			use,
			(mock) => mock.stop,
		).pipe(Effect.provide(FetchHttpClient.layer)),
	);

const responses = getBuiltinModel("openai", "gpt-6.1-sol");

const completions = getBuiltinModel("opencode-go", "glm-5.3-flash");

type ChatModel = typeof responses | typeof completions;

const chatApis: ReadonlyArray<{ readonly api: string; readonly model: ChatModel }> = [
	{ api: "openai-responses", model: responses },
	{ api: "openai-completions", model: completions },
];

const askWith = (model: ChatModel) => (mock: MockOpenAi, messages: Array<Message>) =>
	Effect.promise(() => complete({ ...model, baseUrl: mock.url }, { messages, tools }, { apiKey: "test-key" }));

const userSays = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });

const systemSays = (text: string): Message => ({ role: "system", content: text, timestamp: 0 });

const toolCallOf = (message: AssistantMessage) =>
	Arr.findFirst(message.content, (block): block is ToolCall => block.type === "toolCall");

test.each(chatApis)("over $api, a text reply answers the last user message past a trailing system one", ({ model }) =>
	withMock((mock) =>
		Effect.map(askWith(model)(mock, [userSays("hello there"), systemSays("Answer briefly.")]), (answer) => {
			expect(answer).toMatchObject({
				stopReason: "stop",
				content: [{ type: "text", text: "you said: hello there" }],
			});
		}),
	),
);

test.each(chatApis)("over $api, a tool reply arrives as its text, then a whole tool call", ({ model }) =>
	withMock((mock) =>
		Effect.map(askWith(model)(mock, [userSays("use the tool")]), (answer) => {
			expect(answer).toMatchObject({
				stopReason: "toolUse",
				content: [
					{ type: "text", text: "Looking it up." },
					{ type: "toolCall", name: "lookup", arguments: lookup },
				],
			});
		}),
	),
);

test.each(chatApis)("over $api, the reply after a tool call answers the tool's result", ({ model }) =>
	withMock((mock) =>
		Effect.gen(function* () {
			const asked = userSays("use the tool");
			const called = yield* askWith(model)(mock, [asked]);
			const toolCall = yield* Effect.fromOption(toolCallOf(called));

			const answer = yield* askWith(model)(mock, [
				asked,
				called,
				{
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: [{ type: "text", text: "sunny, 21 C" }],
					isError: false,
					timestamp: 0,
				},
			]);

			expect(answer.content).toMatchObject([{ type: "text", text: "you said: sunny, 21 C" }]);
		}),
	),
);

const question = {
	predicate: { type: "predicate", name: "holds_identifier" },
	choice: { type: "choice", name: "kind" },
};

const Piece = Schema.fromJsonString(Schema.Struct({ piece: Schema.String }));

const Question = Schema.Struct({ type: Schema.String, name: Schema.String });

const DecisionsRequest = Schema.fromJsonString(Schema.Struct({ input: Piece, questions: Schema.Array(Question) }));

const decisionsBody = (piece: string) =>
	Schema.encodeEffect(DecisionsRequest)({ input: { piece }, questions: [question.predicate, question.choice] });

const decide = (mock: MockOpenAi, piece: string) =>
	decisionsBody(piece).pipe(
		Effect.map((body) => HttpClientRequest.bodyText(HttpClientRequest.post(`${mock.url}/decisions`), body)),
		Effect.flatMap(HttpClient.execute),
		Effect.flatMap((response) => response.json),
	);

const pieceOf = (body: string) => Effect.map(Schema.decodeEffect(DecisionsRequest)(body), ({ input }) => input.piece);

test("the judge's Decisions call answers that a piece holds an identifier exactly when it is sealed, of no kind", () =>
	withMock((mock) =>
		Effect.map(Effect.all([decide(mock, `ssn ${ssn}`), decide(mock, "The build uses bun.")]), (answers) => {
			const kindOfNone = { ...question.choice, choice: "none", probabilities: [], confidence: 1 };
			const usage = { input_tokens: 1, output_tokens: 1 };

			expect(answers).toEqual([
				{ answers: [{ ...question.predicate, probability: 1 }, kindOfNone], usage },
				{ answers: [{ ...question.predicate, probability: 0 }, kindOfNone], usage },
			]);
		}),
	));

test("the mock keeps chat bodies and Decisions bodies apart, each oldest first", () =>
	withMock((mock) =>
		Effect.gen(function* () {
			const ask = askWith(responses);

			yield* ask(mock, [userSays("first")]);
			yield* decide(mock, "one");
			yield* ask(mock, [userSays("second")]);
			yield* decide(mock, "two");

			expect(Arr.map(mock.bodies(), (body) => [Str.includes("first")(body), Str.includes("second")(body)])).toEqual([
				[true, false],
				[false, true],
			]);
			const pieces = yield* Effect.forEach(mock.decisions(), pieceOf);

			expect(pieces).toEqual(["one", "two"]);
		}),
	));
