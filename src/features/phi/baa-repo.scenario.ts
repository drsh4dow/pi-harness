import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";
import { type Asked, Reply, serveMock } from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { laneLog, routerSetup } from "./router.fixture.ts";
import { toolUse, wakeAnswered } from "./wire.fixture.ts";

const steps: ReadonlyArray<readonly [string, Reply]> = [
	["STEP-ROOT", toolUse("read")({ path: "notes.txt" })],
	[
		"STEP-CHILD",
		toolUse("delegate")({
			name: "repo child",
			role: "leaf",
			model: "fable",
			goal: "Answer a wire test",
			message: "TASK-CHILD. Read notes.txt, then reply done.",
		}),
	],
	["TASK-CHILD", toolUse("read")({ path: "notes.txt" })],
];

const reply = ({ lastText }: Asked) =>
	Option.getOrElse(
		Option.map(
			Arr.findFirst(steps, ([mark]) => Str.includes(mark)(lastText)),
			([, next]) => next,
		),
		() => Reply.Text({ text: "done" }),
	);

const mocks = { "ultra-a": serveMock(reply), "ultra-b": serveMock(reply), ent: serveMock(reply) };

const judge = serveOpenAi({ reply: () => Reply.Text({ text: "no chat on the judge" }), sealed: () => false });

const router = routerSetup({ env: process.env, claude: mocks, openai: judge, baaRepos: (project) => [project] });

const verdict = (run: Run) =>
	Effect.gen(function* () {
		const open = [...mocks["ultra-a"].bodies(), ...mocks["ultra-b"].bodies()];
		const lanes = yield* laneLog(run);
		const sessions = Arr.dedupe(Arr.map(lanes, ({ session }) => session));

		yield* run.say({
			lanes: Arr.map(lanes, ({ account, lane, model, reason }) => `${lane} ${account} ${model} ${reason}`),
		});
		yield* run.check(open.length === 0, `no request reached an open account (${String(open.length)} did)`);
		yield* run.check(Arr.some(mocks.ent.bodies(), Str.includes("TASK-CHILD")), "the child's brief reached ent");
		yield* run.check(
			sessions.length === 2 && Arr.every(lanes, ({ account, reason }) => account === "ent" && reason === "BAA repo"),
			`each lane line of the root and the child names ent for the BAA repo (${String(sessions.length)} sessions)`,
		);
	});

scenario({
	env: process.env,
	model: "phi/auto",
	files: router.files,
	settings: { packages: [router.checkout] },
	play: (run) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const pwd = yield* run.exec(["pwd"]);

			yield* fs.writeFileString(`${Str.trim(pwd.output)}/notes.txt`, "The build uses bun.\n");
			yield* run.root.prompt("STEP-ROOT. Read the notes.");
			yield* run.root.prompt("STEP-CHILD. Start the child.");
			yield* wakeAnswered(run)(1);
			yield* verdict(run);
		}),
});
