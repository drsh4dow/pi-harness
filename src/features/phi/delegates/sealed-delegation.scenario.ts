import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type Asked, Reply, serveMock } from "#src/features/phi/anthropic.fixture.ts";
import { serveOpenAi } from "#src/features/phi/openai.fixture.ts";
import { laneLog, routerSetup } from "#src/features/phi/router.fixture.ts";
import { foundIn, manifestCases, recordText, toolUse, wakeAnswered } from "#src/features/phi/wire.fixture.ts";
import { eventually } from "#src/primitives/eventually.ts";
import { type Run, scenario } from "#tools/driver/index.ts";

type Task = "rewrite" | "giveup";

const tasks: ReadonlyArray<Task> = ["rewrite", "giveup"];

const stubPattern = /\[sealed (?<handle>h\d+)\]/u;

const rewriteOpening = "phi-router withheld your last answer";

const canaries = MutableRef.make<Readonly<Record<Task, string>>>({ rewrite: "", giveup: "" });

const current = MutableRef.make<Option.Option<{ readonly task: Task; readonly delegated: boolean }>>(Option.none());

interface Served {
	readonly carrier: string;
	readonly lastText: string;
	readonly body: string;
}

const served: Array<Served> = [];

const delegateFor = (task: Task, handle: string) =>
	toolUse("delegate")({
		name: `${task} child`,
		role: "leaf",
		model: "phi/sealed",
		goal: "Answer a wire test",
		message: `TASK-${task}. Summarize the record ${handle} names in one line.`,
	});

const rootReply = ({ lastText }: Asked) => {
	const step = Arr.findFirst(tasks, (task) => Str.includes(`STEP-${task}`)(lastText));

	if (Option.isSome(step)) {
		MutableRef.set(current, Option.some({ task: step.value, delegated: false }));

		return toolUse("read")({ path: `${step.value}.record.txt` });
	}

	const handle = Option.fromNullishOr(stubPattern.exec(lastText)?.groups?.["handle"]);
	const pending = Option.filter(MutableRef.get(current), ({ delegated }) => !delegated);

	if (Option.isSome(handle) && Option.isSome(pending)) {
		MutableRef.set(current, Option.some({ task: pending.value.task, delegated: true }));

		return delegateFor(pending.value.task, handle.value);
	}

	return Reply.Text({ text: "done" });
};

const openReply = (carrier: string) => (asked: Asked) => {
	served.push({ carrier, lastText: asked.lastText, body: asked.body });

	return rootReply(asked);
};

const pinnedReply = (asked: Asked) => {
	served.push({ carrier: "ent", lastText: asked.lastText, body: asked.body });

	const leaked = MutableRef.get(canaries);

	if (Str.includes("TASK-giveup")(asked.body)) {
		return Reply.Text({ text: `LEAK-giveup ${leaked.giveup}` });
	}

	if (Str.includes(rewriteOpening)(asked.lastText)) {
		return Reply.Text({ text: "CLEAN-rewrite: a progress note on diabetes care." });
	}

	return Reply.Text({ text: `LEAK-rewrite ${leaked.rewrite}` });
};

const claude = {
	"ultra-a": serveMock(openReply("ultra-a")),
	"ultra-b": serveMock(openReply("ultra-b")),
	ent: serveMock(pinnedReply),
};

const holdsCanary = (piece: string) =>
	canaries.pipe(
		MutableRef.get,
		Rec.values,
		Arr.some((canary) => canary !== "" && Str.includes(canary)(piece)),
	);

const openai = serveOpenAi({ reply: () => Reply.Text({ text: "done" }), sealed: holdsCanary });

const router = routerSetup({ env: process.env, claude, openai });

const plant = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const project = Str.trim((yield* run.exec(["pwd"])).output);
		const cases = yield* manifestCases;
		const [first, second] = [Arr.headNonEmpty(cases), Option.getOrThrow(Arr.get(cases, 1))];

		MutableRef.set(canaries, {
			rewrite: Arr.headNonEmpty(first.canaries),
			giveup: Arr.headNonEmpty(second.canaries),
		});
		yield* fs.writeFileString(`${project}/rewrite.record.txt`, `${recordText(first)}\n`);
		yield* fs.writeFileString(`${project}/giveup.record.txt`, `${recordText(second)}\n`);

		return [...first.canaries, ...second.canaries];
	});

const Wake = Schema.Struct({ type: Schema.Literal("custom_message"), content: Schema.String });

const decodeWake = Schema.decodeUnknownOption(Wake);

const wakeTexts = (entries: ReadonlyArray<SessionEntry>) =>
	Arr.map(Arr.getSomes(Arr.map(entries, (entry) => decodeWake(entry))), ({ content }) => content);

const Notify = Schema.fromJsonString(
	Schema.Struct({
		type: Schema.Literal("extension_ui_request"),
		method: Schema.Literal("notify"),
		message: Schema.String,
	}),
);

const decodeNotify = Schema.decodeOption(Notify);

const notices = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const out = yield* fs.readFileString(`${Str.slice(0, -"/home".length)(run.home)}/root.out.jsonl`);
		const lines = Arr.filter(Str.split(out, "\n"), Str.isNonEmpty);

		const shown = Arr.getSomes(Arr.map(lines, (line) => decodeNotify(line)));

		return Arr.map(shown, ({ message }) => message);
	}).pipe(Effect.orDie);

const withheldNotice = "of the pinned subagent";

const pinnedLine = "Pinned subagent: 2 runs, 6 rewrites, 1 answer withheld";

const delegateTo = (run: Run) => (task: Task, index: number) =>
	Effect.andThen(run.root.prompt(`STEP-${task}. Read the record and hand it on.`), wakeAnswered(run)(index + 1));

const bodiesOf = (turns: ReadonlyArray<Served>) => Arr.map(turns, ({ body }) => body);

const isRewriteTask = ({ body }: Served) => Str.includes("TASK-rewrite")(body);

const isRewrite = (text: string) => Str.includes(rewriteOpening)(text) && Str.includes("attempt 1 of 5")(text);

const isGiveUp = (wake: string) => stubPattern.test(wake) && Str.includes("after 5 rewrites")(wake);

const shows = (run: Run, line: string) => Effect.map(notices(run), Arr.some(Str.includes(line)));

scenario({
	env: process.env,
	model: "phi/auto",
	offline: true,
	files: router.files,
	settings: { packages: [router.checkout] },
	models: { openai: { baseUrl: openai.url } },
	play: (run) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const planted = yield* plant(run);

			yield* Effect.forEach(tasks, delegateTo(run));

			const sessions = yield* run.waitFor("both delegates' sessions", "10 seconds", (found) =>
				Option.liftPredicate(found, ({ delegates }) => delegates.length === tasks.length),
			);

			const rootSession = sessions.root.id;
			const rootFile = yield* Effect.orDie(fs.readFileString(sessions.root.file));
			const open = Arr.filter(served, ({ carrier }) => carrier !== "ent");
			const pinned = Arr.filter(served, ({ carrier }) => carrier === "ent");
			const openBodies = bodiesOf(open);
			const leakedOpen = foundIn(openBodies)(planted);
			const opened = foundIn(bodiesOf(Arr.filter(pinned, isRewriteTask)))([MutableRef.get(canaries).rewrite]);
			const lanes = yield* laneLog(run);
			const wakes = wakeTexts(sessions.root.entries);

			yield* run.say({ lanes: Arr.map(lanes, ({ account, lane, session }) => `${lane} ${account} ${session}`) });
			yield* run.say({ wakes });
			yield* run.check(
				Arr.some(open, ({ lastText }) => stubPattern.test(lastText)),
				"the root's turn after reading a record stays on an open account and carries a stub with a handle",
			);
			yield* run.check(
				leakedOpen.length === 0,
				`no canary reaches an open account (leaked: ${Arr.join(leakedOpen, ", ")})`,
			);
			yield* run.check(
				opened.length > 0,
				"the phi/sealed delegate's request reaches the BAA account with the handle opened to the canary",
			);
			yield* run.check(
				Arr.isArrayNonEmpty(lanes) && Arr.every(lanes, ({ session }) => session === rootSession),
				`every request, the delegates' included, carries the root's session ${rootSession}`,
			);
			yield* run.check(
				Arr.some(pinned, ({ lastText }) => isRewrite(lastText)),
				"the delegate's request after a rewrite carries the router's rewrite message",
			);
			yield* run.check(Arr.some(wakes, Str.includes("CLEAN-rewrite")), "the root wakes with the clean answer");
			yield* run.check(
				Arr.some(wakes, isGiveUp),
				"the root wakes with the handle and the router's line for the answer it gave up on",
			);
			yield* run.check(
				!Str.includes("LEAK-")(rootFile) && foundIn(wakes)(planted).length === 0,
				"the root's session holds no sealed answer, and no wake holds a canary",
			);
			yield* run.check(!Arr.some(openBodies, Str.includes("LEAK-")), "no sealed answer reaches an open account");

			yield* Effect.orDie(eventually(shows(run, withheldNotice), "30 seconds"));
			yield* run.root.prompt("/phi");
			yield* Effect.orDie(eventually(shows(run, pinnedLine), "30 seconds"));

			const shown = yield* notices(run);

			yield* run.say({ notices: shown });
			yield* run.check(
				Arr.filter(shown, Str.includes(withheldNotice)).length === 1,
				"the root shows the withheld-answer notice once",
			);
		}),
});
