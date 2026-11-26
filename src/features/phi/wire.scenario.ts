import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";
import {
	type Asked,
	compactionPrompt,
	type MockAnthropic,
	Reply,
	serveMock,
	turnPrefixPrompt,
} from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { holdsStub, laneLog, routerSetup } from "./router.fixture.ts";
import { type Case, foundIn, manifestCases, providersOf, recordText, toolUse, wakeAnswered } from "./wire.fixture.ts";

const readRecord = ({ id, strata }: Case) =>
	strata.entry === "file-read"
		? toolUse("read")({ path: `records/${id}.txt` })
		: toolUse("bash")({ command: `cat records/${id}.txt` });

const recordSteps = (cases: ReadonlyArray<Case>) =>
	Arr.zip(
		["STEP-PHI", ...Arr.map(cases, ({ canaries }) => Arr.headNonEmpty(canaries))],
		[...Arr.map(cases, readRecord), Reply.Text({ text: "done" })],
	);

const planted = MutableRef.make<ReadonlyArray<Case>>([]);

const steps: ReadonlyArray<readonly [string, Reply]> = [
	["STEP-CLEAN", toolUse("read")({ path: "notes.txt" })],
	[
		"STEP-DELEGATE",
		toolUse("delegate")({
			name: "wire child",
			role: "leaf",
			model: "judgment",
			goal: "Answer a wire test",
			message: "CHILD-TASK. Reply with the single word ok and call no tool.",
		}),
	],
	["STEP-CODEMODE", toolUse("codemode")({ code: 'const m = await models.classify("x", {}); return m;' })],
];

const isSummary = (body: string) => Str.includes(compactionPrompt)(body) || Str.includes(turnPrefixPrompt)(body);

const reply = ({ lastText, body }: Asked) => {
	if (isSummary(body)) {
		return Reply.Text({ text: "The agent read the notes and the records." });
	}

	const cases = MutableRef.get(planted);
	const step = Arr.findFirst([...steps, ...recordSteps(cases)], ([word]) => Str.includes(word)(lastText));

	return Option.getOrElse(
		Option.map(step, ([, next]) => next),
		() => Reply.Text({ text: "done" }),
	);
};

type Counts = Readonly<Record<"ultra-a" | "ultra-b" | "ent", number>>;

const atFirstEnt = MutableRef.make(Option.none<Counts>());

const counts = (served: Readonly<Record<keyof Counts, MockAnthropic>>): Counts => ({
	"ultra-a": served["ultra-a"].bodies().length,
	"ultra-b": served["ultra-b"].bodies().length,
	ent: served.ent.bodies().length,
});

const mocks = {
	"ultra-a": serveMock(reply),
	"ultra-b": serveMock(reply),
	ent: serveMock((asked) => {
		MutableRef.update(
			atFirstEnt,
			Option.orElseSome(() => counts(mocks)),
		);

		return reply(asked);
	}),
};

const judge = serveOpenAi({
	reply: () => Reply.Text({ text: "no chat on the judge" }),
	sealed: (piece) =>
		Arr.some(MutableRef.get(planted), ({ canaries }) => Arr.some(canaries, (canary) => Str.includes(canary)(piece))),
});

const openBodies = () => [...mocks["ultra-a"].bodies(), ...mocks["ultra-b"].bodies()];

const notes = `${Arr.join(Arr.replicate("The build uses bun and the tests live next to the code.", 250), "\n")}\n`;

const plant = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pwd = yield* run.exec(["pwd"]);
		const project = Str.trim(pwd.output);
		const cases = yield* manifestCases;

		MutableRef.set(planted, cases);

		yield* fs.writeFileString(`${project}/notes.txt`, notes);
		yield* fs.makeDirectory(`${project}/records`);
		yield* Effect.forEach(cases, (record) =>
			fs.writeFileString(`${project}/records/${record.id}.txt`, `${recordText(record)}\n`),
		);

		return Arr.flatMap(cases, ({ canaries }) => canaries);
	});

const TextBlock = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });

const BlockedCodemode = Schema.Struct({
	type: Schema.Literal("message"),
	message: Schema.Struct({
		role: Schema.Literal("toolResult"),
		toolName: Schema.Literal("codemode"),
		isError: Schema.Literal(true),
		content: Schema.Array(TextBlock),
	}),
});

const isBlockedCodemode = (entry: SessionEntry) =>
	Option.exists(Schema.decodeUnknownOption(BlockedCodemode)(entry), ({ message }) =>
		Arr.some(message.content, ({ text }) => Str.includes("outside phi-router")(text)),
	);

const stepsAfterSeal = (run: Run) =>
	Effect.gen(function* () {
		yield* run.root.prompt("STEP-AFTER. A clean question after the records were read.");
		yield* run.root.prompt("STEP-DELEGATE. Start the delegate.");
		yield* wakeAnswered(run)(1);
		yield* run.root.prompt("STEP-CODEMODE. Run the script.");
		yield* run.root.compact;
		yield* run.root.prompt("STEP-FINAL. One more clean question.");
	});

const finalState = (run: Run) =>
	run.waitFor("every session", "10 seconds", ({ root, delegates }) =>
		Option.some({
			rootProviders: providersOf(root.entries),
			childProviders: Arr.flatMap(delegates, ({ entries }) => providersOf(entries)),
			blocked: Arr.some(root.entries, isBlockedCodemode),
		}),
	);

interface Seen {
	readonly canaries: ReadonlyArray<string>;
	readonly atSeal: Counts;
	readonly atEnd: Counts;
	readonly childProviders: ReadonlyArray<string>;
	readonly blocked: boolean;
}

const openCount = (counted: Counts) => counted["ultra-a"] + counted["ultra-b"];

const noLeak = (run: Run, { canaries, atSeal }: Seen) =>
	Effect.gen(function* () {
		const leaked = foundIn(openBodies())(canaries);
		const missing = Arr.difference(canaries, foundIn(mocks.ent.bodies())(canaries));

		yield* run.check(
			canaries.length === 12,
			`the manifest plants 12 canaries (it planted ${String(canaries.length)})`,
		);
		yield* run.check(
			leaked.length === 0,
			`no canary reaches an open account's mock (leaked: ${Arr.join(leaked, ", ")})`,
		);
		yield* run.check(missing.length === 0, `every canary reached the ent mock (missing: ${Arr.join(missing, ", ")})`);
		yield* run.check(
			openCount(atSeal) >= 2,
			`the clean turns reached an open account's mock (${String(openCount(atSeal))} requests)`,
		);
	});

const backOnOpen = (run: Run, { atSeal, atEnd, childProviders, blocked }: Seen) =>
	Effect.gen(function* () {
		const later = Arr.drop(openBodies(), openCount(atSeal));
		const childOnPhi = childProviders.length > 0 && Arr.every(childProviders, (provider) => provider === "phi");

		yield* run.check(
			openCount(atEnd) > openCount(atSeal),
			`requests after the seal returned to an open account's mock (${String(openCount(atSeal))} at the seal, ${String(openCount(atEnd))} at the end)`,
		);
		yield* run.check(
			Arr.some(later, holdsStub),
			"a body to an open account after the seal carries the records withheld",
		);
		yield* run.check(
			childOnPhi && Arr.some(openBodies(), Str.includes("CHILD-TASK")),
			`the judgment child ran through phi-router, which sent its clean brief to an open account's mock (its answers came from ${Arr.join(childProviders, ", ")})`,
		);
		const narratives = Arr.filter([...openBodies(), ...mocks.ent.bodies()], Str.includes(compactionPrompt));

		yield* run.check(
			narratives.length > 0,
			`the compaction's narrative request went through phi-router (${String(narratives.length)} narrative requests)`,
		);
		yield* run.check(blocked, "the codemode script that calls models was blocked by the PHI guard");
	});

const lanesSeen = (run: Run) =>
	Effect.gen(function* () {
		const lines = yield* laneLog(run);
		const rows = Arr.map(lines, ({ account, lane, model, reason }) => `${lane} ${account} ${model} ${reason}`);
		const first = Arr.findFirstIndex(lines, ({ lane }) => lane === "sealed");

		const cleanAfter = Option.exists(first, (index) =>
			Arr.some(Arr.drop(lines, index + 1), ({ lane }) => lane === "clean"),
		);

		yield* run.say({ lanes: rows });
		yield* run.check(
			Option.isSome(first) && cleanAfter,
			`phi-router's lane log shows a sealed request and clean ones after it (${String(lines.length)} lines)`,
		);
		yield* run.check(
			Arr.every(lines, ({ lane, account }) => (lane === "sealed") === (account === "ent")),
			"each sealed line names ent and each clean line an open account",
		);
	});

const verdict = (run: Run, { canaries, atSeal }: Pick<Seen, "canaries" | "atSeal">) =>
	Effect.gen(function* () {
		const { rootProviders, childProviders, blocked } = yield* finalState(run);
		const seen = { canaries, atSeal, atEnd: counts(mocks), childProviders, blocked };

		yield* run.say({ atSeal, atEnd: seen.atEnd, rootProviders, childProviders, judged: judge.decisions().length });
		yield* noLeak(run, seen);
		yield* backOnOpen(run, seen);
		yield* lanesSeen(run);
	});

const router = routerSetup({ env: process.env, claude: mocks, openai: judge });

scenario({
	env: process.env,
	model: "phi/auto",
	offline: true,
	files: router.files,
	settings: { compaction: { enabled: true, keepRecentTokens: 1000 }, packages: [router.checkout] },
	play: (run) =>
		Effect.gen(function* () {
			const canaries = yield* plant(run);

			yield* run.root.prompt("STEP-CLEAN. Read the notes.");
			yield* run.root.prompt("STEP-PHI. Read the records one at a time.");

			const atSeal = Option.getOrElse(MutableRef.get(atFirstEnt), () => counts(mocks));

			yield* stepsAfterSeal(run);
			yield* verdict(run, { canaries, atSeal });
		}),
});
