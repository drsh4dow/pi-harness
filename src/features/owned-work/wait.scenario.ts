/**
 * A root that holds a watch calls `wait`: the watch's result comes back in the wait's reply within a second of its
 * settle, and no wake carries it again. A second wait ends within a second of the human's steer, with its watch still
 * running.
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";
import { entryKind } from "./recorded.ts";

const Settled = Schema.Struct({
	type: Schema.Literal("custom"),
	customType: Schema.Literal(entryKind),
	timestamp: Schema.String,
	data: Schema.Struct({ type: Schema.Literal("job-settled"), handle: Schema.String }),
});

const Call = Schema.Struct({ type: Schema.String, name: Schema.optionalKey(Schema.String) });

const WaitCall = Schema.Struct({
	type: Schema.Literal("message"),
	message: Schema.Struct({ role: Schema.Literal("assistant"), timestamp: Schema.Finite, content: Schema.Array(Call) }),
});

const Text = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) });

const ReplyMessage = Schema.Struct({
	role: Schema.Literal("toolResult"),
	toolName: Schema.Literal("wait"),
	timestamp: Schema.Finite,
	content: Schema.Array(Text),
});

const WaitReply = Schema.Struct({ type: Schema.Literal("message"), message: ReplyMessage });

const Wake = Schema.Struct({
	type: Schema.Literal("custom_message"),
	customType: Schema.Literal(entryKind),
	details: Schema.Struct({ ref: Schema.String }),
});

const decodeReply = Schema.decodeUnknownOption(WaitReply);

const settledOf = (entries: ReadonlyArray<SessionEntry>, ref: string) =>
	Arr.findFirst(entries, (entry) =>
		Option.filter(Schema.decodeUnknownOption(Settled)(entry), ({ data }) => data.handle === ref),
	);

const callsWait = ({ message }: typeof WaitCall.Type) =>
	Arr.some(message.content, ({ type, name }) => type === "toolCall" && name === "wait");

const waitCalls = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.filter(Arr.getSomes(Arr.map(entries, (entry) => Schema.decodeUnknownOption(WaitCall)(entry))), callsWait);

const waitReplies = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.getSomes(Arr.map(entries, (entry) => decodeReply(entry)));

const wakesFor = (entries: ReadonlyArray<SessionEntry>, ref: string) =>
	Arr.filter(entries, (entry) =>
		Option.exists(Schema.decodeUnknownOption(Wake)(entry), ({ details }) => details.ref === ref),
	);

const textOf = ({ message }: typeof WaitReply.Type) =>
	Arr.join(Arr.getSomes(Arr.map(message.content, ({ text }) => Option.fromUndefinedOr(text))), "\n");

const settledWait = (run: Run) =>
	Effect.gen(function* () {
		yield* run.root.prompt(
			"Use the watch tool once, named nap, with the command `sleep 15 && echo napped`. Then call the wait tool once with no arguments. When it returns, reply with the single word done.",
		);

		const found = yield* run.waitFor("watch-1's settle, the first wait and its reply", "10 seconds", ({ root }) =>
			Option.all({
				settled: settledOf(root.entries, "watch-1"),
				call: Arr.head(waitCalls(root.entries)),
				reply: Arr.head(waitReplies(root.entries)),
			}),
		);

		const settledAt = Date.parse(found.settled.timestamp);
		const calledBefore = settledAt - found.call.message.timestamp;
		const lag = found.reply.message.timestamp - settledAt;
		const text = textOf(found.reply);

		yield* run.say({ waitCalledMsBeforeSettle: calledBefore, replyMsAfterSettle: lag });
		yield* run.check(
			calledBefore > 0,
			`the root called wait before watch-1 settled (${String(calledBefore)} ms before)`,
		);
		yield* run.check(lag >= 0 && lag <= 1000, `the wait replied within 1 s of watch-1's settle (${String(lag)} ms)`);
		yield* run.check(
			Str.includes('"ref":"watch-1"')(text) && Str.includes("napped")(text),
			`the wait's reply carries watch-1's result (it reads ${text})`,
		);
	});

const steeredWait = (run: Run) =>
	Effect.gen(function* () {
		const prompt = yield* Effect.forkChild(
			run.root.prompt(
				"Use the watch tool once, named long nap, with the command `sleep 300 && echo napped`. Then call the wait tool once with no arguments. Afterwards, do what any message from me says.",
			),
		);

		yield* run.waitFor("the second wait call", "2 minutes", ({ root }) => Arr.get(waitCalls(root.entries), 1));

		const steeredAt = yield* Clock.currentTimeMillis;

		yield* run.root.steer("Stop waiting. Cancel the long nap watch and reply with the single word stopped.");

		const reply = yield* run.waitFor("the second wait's reply", "30 seconds", ({ root }) =>
			Arr.get(waitReplies(root.entries), 1),
		);

		const lag = reply.message.timestamp - steeredAt;
		const text = textOf(reply);

		yield* run.say({ secondReplyMsAfterSteer: lag, secondReply: text });
		yield* run.check(
			lag <= 1000 && Str.includes("watch-2 still run")(text),
			`the second wait replied within 1 s of the steer, naming watch-2 as running (${String(lag)} ms, it reads ${text})`,
		);
		yield* Fiber.join(prompt);
	});

scenario({
	env: process.env,
	model: "ultra-a/claude-fable-5-2",
	play: (run) =>
		Effect.gen(function* () {
			yield* settledWait(run);
			yield* steeredWait(run);

			const wakes = yield* run.waitFor("the root's session", "5 seconds", ({ root }) =>
				Option.some(wakesFor(root.entries, "watch-1")),
			);

			yield* run.check(
				wakes.length === 0,
				`no wake carried watch-1 after the wait did (${String(wakes.length)} did)`,
			);
		}),
});
