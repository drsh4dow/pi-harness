import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Run, type Session, scenario } from "#tools/driver/index.ts";
import { type Asked, Reply, serveMock } from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { holdsStub, laneLog, pinnedOf, routerCommand, routerSetup } from "./router.fixture.ts";
import { foundIn, manifestCases, recordText, toolUse, wakeAnswered } from "./wire.fixture.ts";

type Carrier = "ultra-a" | "ultra-b" | "ent" | "openai" | "opencode-go";

const openCarriers: ReadonlyArray<Carrier> = ["ultra-a", "ultra-b", "opencode-go"];

const onEnt = "ent/claude-opus-5-5";

/**
 * What the design promises for one child: the alias it names, the model its pi starts on, and the `account/id` its
 * turns land on. `mark` tells its turns apart.
 */
interface Child {
	readonly mark: string;
	readonly alias: "judgment" | "worker" | "fable" | "investigator" | "divergent";
	readonly key: string;
	readonly clean: ReadonlyArray<string>;
	readonly sealed: string;
	/** Whether phi-router holds the child's session pinned, or nothing for a child outside phi-router. */
	readonly pinned?: boolean;
}

const onOpen = (id: string) => [`ultra-a/${id}`, `ultra-b/${id}`];

const children: ReadonlyArray<Child> = [
	{
		mark: "judgment",
		alias: "judgment",
		key: "phi/claude-opus-5-5",
		clean: onOpen("claude-opus-5-5"),
		sealed: onEnt,
		pinned: false,
	},
	{
		mark: "worker",
		alias: "worker",
		key: "phi/claude-opus-5-5",
		clean: onOpen("claude-opus-5-5"),
		sealed: onEnt,
		pinned: false,
	},
	{
		mark: "fable",
		alias: "fable",
		key: "phi/claude-fable-5-2",
		clean: onOpen("claude-fable-5-2"),
		sealed: onEnt,
		pinned: false,
	},
	{
		mark: "investigator",
		alias: "investigator",
		key: "openai/gpt-6.1-sol",
		clean: ["openai/gpt-6.1-sol"],
		sealed: "openai/gpt-6.1-sol",
	},
	{ mark: "divergent", alias: "divergent", key: "phi/sealed", clean: [onEnt], sealed: onEnt, pinned: false },
	{ mark: "held", alias: "worker", key: "phi/claude-opus-5-5", clean: [onEnt], sealed: onEnt, pinned: true },
];

const pinnedFrom = children.length - 1;

/** The words that tell the mocks which turn they answer: the root's prompt, the child's brief and its two tool results. */
const marksOf = ({ mark }: Pick<Child, "mark">) => ({
	step: `STEP-${mark}`,
	task: `TASK-${mark}`,
	record: `RECORD-${mark}`,
	after: `AFTER-${mark}`,
});

const stepsOf = (child: Child): ReadonlyArray<readonly [string, Reply]> => {
	const mark = marksOf(child);

	return [
		[
			mark.step,
			toolUse("delegate")({
				name: `${child.mark} child`,
				role: "leaf",
				model: child.alias,
				goal: "Answer a wire test",
				message: `${mark.task}. Read ${child.mark}.record.txt, then ${child.mark}.after.txt, then reply done.`,
			}),
		],
		[mark.task, toolUse("read")({ path: `${child.mark}.record.txt` })],
		[mark.record, toolUse("read")({ path: `${child.mark}.after.txt` })],
		[mark.after, Reply.Text({ text: "done" })],
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

const pinRoot = (run: Run) =>
	Effect.gen(function* () {
		const session = yield* run.waitFor("the root's session", "10 seconds", ({ root }) => Option.some(root.id));
		const pinned = yield* run.exec([routerCommand(router.checkout), "pin", "--session", session]);

		yield* run.check(pinned.code === 0, `phi-router pinned the root (${Str.trim(pinned.output)})`);
	});

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
				fs.writeFileString(`${project}/${child.mark}.record.txt`, `${mark.record}\n${text}\n`),
				fs.writeFileString(`${project}/${child.mark}.after.txt`, `${mark.after}. The build uses bun.\n`),
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

const landed = (run: Run, child: Child, planted: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const mark = marksOf(child);
		const [task, record, after] = [turnsOf(mark.task), turnsOf(mark.record), turnsOf(mark.after)];
		const onClean = (turn: Served) => Arr.contains(child.clean, pairOf(turn));
		const onSealed = (turn: Served) => pairOf(turn) === child.sealed;

		yield* run.check(
			Arr.isArrayNonEmpty(task) && Arr.every(task, onClean),
			`the ${child.mark} child's clean brief went to ${Arr.join(child.clean, " or ")} (it went to ${pairsOf(task)})`,
		);
		yield* run.check(
			Arr.isArrayNonEmpty(record) && Arr.every(record, onSealed),
			`the ${child.mark} child's sealed turn went to ${child.sealed} (it went to ${pairsOf(record)})`,
		);
		yield* run.check(
			Arr.isArrayNonEmpty(after) && Arr.every(after, onClean),
			`the ${child.mark} child's clean turn after the seal went to ${Arr.join(child.clean, " or ")} (it went to ${pairsOf(after)})`,
		);
		yield* run.check(
			Arr.every([...record, ...after], recordAsDue(planted)),
			`each of the ${child.mark} child's turns from the record on carries it raw to a BAA account and withheld from an open one`,
		);
	});

const startedOn = (run: Run, child: Child, sessions: ReadonlyArray<Session>) =>
	Effect.gen(function* () {
		const { task } = marksOf(child);
		const session = Arr.findFirst(sessions, ({ requests }) => Arr.some(requests, Str.includes(task)));
		const loaded = Option.flatMap(session, (found) => found.loaded);

		const model = Option.getOrElse(
			Option.map(loaded, (found) => found.model),
			() => "nothing recorded",
		);

		const pinned = yield* Option.match(session, {
			onNone: () => Effect.succeedNone,
			onSome: ({ id }) => pinnedOf({ run, checkout: router.checkout, session: id }),
		});

		yield* run.say({ child: child.mark, startedOn: model, pinned: Option.getOrNull(pinned) });
		yield* run.check(model === child.key, `the ${child.mark} child's pi runs on ${child.key} (it runs on ${model})`);
		yield* run.check(
			child.pinned === undefined || Option.contains(pinned, child.pinned),
			`phi-router reports the ${child.mark} child ${child.pinned === true ? "pinned" : "not pinned"}`,
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

const startChild = (run: Run) => (child: Child, index: number) =>
	Effect.andThen(
		run.root.prompt(`${marksOf(child).step}. Start the ${child.mark} child.`),
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
			const [beforePin, afterPin] = Arr.splitAt(children, pinnedFrom);

			yield* Effect.forEach(beforePin, startChild(run));

			yield* pinRoot(run);
			yield* Effect.forEach(afterPin, (child, index) => startChild(run)(child, index + beforePin.length));

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
