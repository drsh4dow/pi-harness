import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { entryKind } from "#src/features/owned-work/index.ts";
import { scenario, type Sessions } from "#tools/driver/index.ts";

const { env } = process;

const given = (name: string) => {
	const value = env[name];

	if (value === undefined) {
		throw new Error(`${name} is unset: run this scenario through accounts.sh`);
	}

	return value;
};

const checkout = given("PHI_ROUTER_CHECKOUT");

const record = given("PHI_ACCOUNTS_RECORD");

const prompt = given("PHI_ACCOUNTS_PROMPT");

const rootEnv = {
	XDG_STATE_HOME: given("PHI_ROUTER_STATE"),
	XDG_CONFIG_HOME: given("PHI_ROUTER_CONFIG_HOME"),
	PHI_ROUTER_PORT: given("PHI_ROUTER_PORT"),
};

const budget = "4 minutes";

const Outcome = Schema.Struct({
	answer: Schema.String,
	delegates: Schema.Array(Schema.String),
	wakes: Schema.Array(Schema.String),
});

const encodeOutcome = Schema.encodeEffect(Schema.fromJsonString(Outcome));

type Content = string | ReadonlyArray<{ readonly type: string; readonly text?: string }>;

const textOf = (content: Content) =>
	Predicate.isString(content)
		? content
		: Arr.join(
				Arr.flatMap(content, (block) => (block.type === "text" && block.text !== undefined ? [block.text] : [])),
				"\n",
			);

const assistantOf = (entry: SessionEntry) =>
	entry.type === "message" && entry.message.role === "assistant" ? Option.some(entry.message) : Option.none();

const delegateCalls = (entry: SessionEntry) =>
	Option.match(assistantOf(entry), {
		onNone: () => [],
		onSome: ({ content }) => Arr.filter(content, (block) => block.type === "toolCall" && block.name === "delegate"),
	});

const wakesOf = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.flatMap(entries, (entry) =>
		entry.type === "custom_message" && entry.customType === entryKind ? [textOf(entry.content)] : [],
	);

const finalAnswer = ({ root: { entries } }: Sessions) => {
	const woken = wakesOf(entries).length >= Arr.flatMap(entries, delegateCalls).length;

	const settled = Option.filter(
		Option.flatMap(Arr.last(entries), assistantOf),
		({ stopReason }) => stopReason === "stop",
	);

	return Option.map(
		Option.filter(settled, () => woken),
		({ content }) => textOf(content),
	);
};

const lastAnswer = ({ root: { entries } }: Sessions) => {
	const answers = Arr.getSomes(Arr.map(entries, assistantOf));

	return Option.match(Arr.last(answers), { onNone: () => "", onSome: ({ content }) => textOf(content) });
};

scenario({
	env,
	model: "phi/auto",
	offline: env["PHI_ACCOUNTS_OFFLINE"] === "1",
	rootEnv,
	settings: { packages: [checkout] },
	play: (run) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const project = Str.trim((yield* run.exec(["pwd"])).output);

			yield* fs.writeFileString(`${project}/overdue.txt`, record);

			const answered = yield* Effect.exit(
				Effect.andThen(
					run.root.prompt(prompt, budget),
					run.waitFor("the root's answer after its delegates' wakes", budget, finalAnswer),
				).pipe(
					Effect.timeoutOrElse({
						duration: budget,
						orElse: () => run.check(false, `the root gave no final answer within ${budget}`),
					}),
				),
			);

			const sessions = yield* run.waitFor("the run's sessions", "10 seconds", Option.some);

			const delegates = Arr.getSomes(
				Arr.map(sessions.delegates, ({ loaded }) => Option.map(loaded, ({ model }) => model)),
			);

			const outcome = yield* Effect.orDie(
				encodeOutcome({ answer: lastAnswer(sessions), delegates, wakes: wakesOf(sessions.root.entries) }),
			);

			yield* run.say(`phi-accounts ${outcome}`);
			yield* answered;
		}),
});
