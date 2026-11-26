import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Asked, Reply, serveMock } from "#src/features/phi/anthropic.fixture.ts";
import { serveOpenAi } from "#src/features/phi/openai.fixture.ts";
import { holdsStub, laneLog, routerSetup } from "#src/features/phi/router.fixture.ts";
import { foundIn, manifestCases, recordText, toolUse, wakeAnswered } from "#src/features/phi/wire.fixture.ts";
import { type Run, type Session, scenario } from "#tools/driver/index.ts";

type Carrier = "ultra-a" | "ultra-b" | "ent" | "openai" | "opencode-go";

const openCarriers: ReadonlyArray<Carrier> = ["ultra-a", "ultra-b", "opencode-go"];

const onEnt = "ent/claude-opus-5-5";

interface ExpectedChild {
	readonly mark: string;
	readonly alias: "judgment" | "worker" | "fable" | "investigator" | "divergent";
	readonly startsOn: string;
	readonly cleanLandsOn: ReadonlyArray<string>;
	readonly sealedLandsOn: string;
}

const onOpen = (id: string) => [`ultra-a/${id}`, `ultra-b/${id}`];

const children: ReadonlyArray<ExpectedChild> = [
	{
		mark: "judgment",
		alias: "judgment",
		startsOn: "phi/claude-opus-5-5",
		cleanLandsOn: onOpen("claude-opus-5-5"),
		sealedLandsOn: onEnt,
	},
	{
		mark: "worker",
		alias: "worker",
		startsOn: "phi/claude-opus-5-5",
		cleanLandsOn: onOpen("claude-opus-5-5"),
		sealedLandsOn: onEnt,
	},
	{
		mark: "fable",
		alias: "fable",
		startsOn: "phi/claude-fable-5-2",
		cleanLandsOn: onOpen("claude-fable-5-2"),
		sealedLandsOn: onEnt,
	},
	{
		mark: "investigator",
		alias: "investigator",
		startsOn: "openai/gpt-6.1-sol",
		cleanLandsOn: ["openai/gpt-6.1-sol"],
		sealedLandsOn: "openai/gpt-6.1-sol",
	},
	{
		mark: "divergent",
		alias: "divergent",
		startsOn: "phi/sealed",
		cleanLandsOn: [onEnt],
		sealedLandsOn: onEnt,
	},
];

const marksOf = ({ mark }: Pick<ExpectedChild, "mark">) => ({
	rootPrompt: `STEP-${mark}`,
	brief: `TASK-${mark}`,
	recordResult: `RECORD-${mark}`,
	afterResult: `AFTER-${mark}`,
});

const stepsOf = (child: ExpectedChild): ReadonlyArray<readonly [string, Reply]> => {
	const mark = marksOf(child);

	return [
		[
			mark.rootPrompt,
			toolUse("delegate")({
				name: `${child.mark} child`,
				role: "leaf",
				model: child.alias,
				goal: "Answer a wire test",
				message: `${mark.brief}. Read ${child.mark}.record.txt, then ${child.mark}.after.txt, then reply done.`,
			}),
		],
		[mark.brief, toolUse("read")({ path: `${child.mark}.record.txt` })],
		[mark.recordResult, toolUse("read")({ path: `${child.mark}.after.txt` })],
		[mark.afterResult, Reply.Text({ text: "done" })],
	];
};

const steps = Arr.flatMap(children, stepsOf);

interface Served {
	readonly carrier: Carrier;
	readonly model: string;
	readonly mark: Option.Option<string>;
	readonly body: string;
}

const served: Array<Served> = [];

const replying = (carrier: Carrier) => (asked: Asked) => {
	const step = Arr.findFirst(steps, ([mark]) => Str.includes(mark)(asked.lastText));

	served.push({ carrier, model: asked.model, mark: Option.map(step, ([mark]) => mark), body: asked.body });

	return Option.getOrElse(
		Option.map(step, ([, next]) => next),
		() => Reply.Text({ text: "done" }),
	);
};

const canaries = MutableRef.make<ReadonlyArray<string>>([]);

const holdsCanary = (piece: string) => Arr.some(MutableRef.get(canaries), (canary) => Str.includes(canary)(piece));

const claude = {
	"ultra-a": serveMock(replying("ultra-a")),
	"ultra-b": serveMock(replying("ultra-b")),
	ent: serveMock(replying("ent")),
};

const openai = serveOpenAi({ reply: replying("openai"), sealed: holdsCanary });

const opencodeGo = serveOpenAi({ reply: replying("opencode-go"), sealed: () => false });

const router = routerSetup({ env: process.env, claude, openai });

const openBodies = () => [...claude["ultra-a"].bodies(), ...claude["ultra-b"].bodies(), ...opencodeGo.bodies()];

const plant = (run: Run) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const pwd = yield* run.exec(["pwd"]);
		const project = Str.trim(pwd.output);
		const record = yield* Effect.map(manifestCases, Arr.headNonEmpty);
		const text = recordText(record);

		MutableRef.set(canaries, record.canaries);

		yield* Effect.forEach(children, (child) => {
			const mark = marksOf(child);

			return Effect.andThen(
				fs.writeFileString(`${project}/${child.mark}.record.txt`, `${mark.recordResult}\n${text}\n`),
				fs.writeFileString(`${project}/${child.mark}.after.txt`, `${mark.afterResult}. The build uses bun.\n`),
			);
		});

		return record.canaries;
	});

const turnsOf = (mark: string) => Arr.filter(served, (turn) => Option.contains(turn.mark, mark));

const pairOf = ({ carrier, model }: Served) => `${carrier}/${model}`;

const pairsOf = (turns: ReadonlyArray<Served>) => Arr.join(Arr.map(turns, pairOf), ", ");

const recordAsDue = (planted: ReadonlyArray<string>) => (turn: Served) => {
	const raw = foundIn([turn.body])(planted).length > 0;

	return Arr.contains(openCarriers, turn.carrier) ? !raw && holdsStub(turn.body) : raw;
};

const landed = (run: Run, child: ExpectedChild, planted: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const mark = marksOf(child);
		const [task, record, after] = [turnsOf(mark.brief), turnsOf(mark.recordResult), turnsOf(mark.afterResult)];
		const onClean = (turn: Served) => Arr.contains(child.cleanLandsOn, pairOf(turn));
		const onSealed = (turn: Served) => pairOf(turn) === child.sealedLandsOn;

		yield* run.check(
			Arr.isArrayNonEmpty(task) && Arr.every(task, onClean),
			`the ${child.mark} child's clean brief went to ${Arr.join(child.cleanLandsOn, " or ")} (it went to ${pairsOf(task)})`,
		);
		yield* run.check(
			Arr.isArrayNonEmpty(record) && Arr.every(record, onSealed),
			`the ${child.mark} child's sealed turn went to ${child.sealedLandsOn} (it went to ${pairsOf(record)})`,
		);
		yield* run.check(
			Arr.isArrayNonEmpty(after) && Arr.every(after, onClean),
			`the ${child.mark} child's clean turn after the seal went to ${Arr.join(child.cleanLandsOn, " or ")} (it went to ${pairsOf(after)})`,
		);
		yield* run.check(
			Arr.every([...record, ...after], recordAsDue(planted)),
			`each of the ${child.mark} child's turns from the record on carries it raw to a BAA account and withheld from an open one`,
		);
	});

const startedOn = (run: Run, child: ExpectedChild, sessions: ReadonlyArray<Session>) =>
	Effect.gen(function* () {
		const { brief } = marksOf(child);
		const session = Arr.findFirst(sessions, ({ requests }) => Arr.some(requests, Str.includes(brief)));
		const loaded = Option.flatMap(session, (found) => found.loaded);

		const model = Option.getOrElse(
			Option.map(loaded, (found) => found.model),
			() => "nothing recorded",
		);

		yield* run.say({ child: child.mark, startedOn: model });
		yield* run.check(
			model === child.startsOn,
			`the ${child.mark} child's pi runs on ${child.startsOn} (it runs on ${model})`,
		);
	});

const noLeak = (run: Run, planted: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const leaked = foundIn(openBodies())(planted);
		const lanes = yield* laneLog(run);

		yield* run.say({
			lanes: Arr.map(lanes, ({ account, lane, model, reason }) => `${lane} ${account} ${model} ${reason}`),
		});
		yield* run.check(
			leaked.length === 0,
			`no canary reaches an open account's mock (leaked: ${Arr.join(leaked, ", ")})`,
		);
		yield* run.check(opencodeGo.bodies().length === 0, "no request reached opencode-go");
		yield* run.check(
			foundIn(openai.decisions())(planted).length > 0,
			`phi-router's judge read the record raw (${String(openai.decisions().length)} calls)`,
		);
	});

const startChild = (run: Run) => (child: ExpectedChild, index: number) =>
	Effect.andThen(
		run.root.prompt(`${marksOf(child).rootPrompt}. Start the ${child.mark} child.`),
		wakeAnswered(run)(index + 1),
	);

scenario({
	env: process.env,
	model: "phi/auto",
	files: router.files,
	settings: { packages: [router.checkout] },
	models: { openai: { baseUrl: openai.url }, "opencode-go": { baseUrl: opencodeGo.url } },
	play: (run) =>
		Effect.gen(function* () {
			const planted = yield* plant(run);

			yield* Effect.forEach(children, startChild(run));

			const sessions = yield* run.waitFor("every child's session", "10 seconds", ({ delegates }) =>
				Option.liftPredicate(delegates, (all) => all.length === children.length),
			);

			yield* run.say({
				served: Arr.map(served, ({ carrier, model, mark }) => [carrier, model, Option.getOrElse(mark, () => "")]),
			});
			yield* Effect.forEach(children, (child) =>
				Effect.andThen(landed(run, child, planted), startedOn(run, child, sessions)),
			);
			yield* noLeak(run, planted);
		}),
});
