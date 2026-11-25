import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";
import { Reply, serveMock } from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { laneLog, routerSetup } from "./router.fixture.ts";

const ssn = "123-45-6789";

const prompts = {
	sealed: `Synthetic intake: Maria Delgado-Ruiz, ssn ${ssn}. Reply with the single word done.`,
	after: "Reply with the single word done.",
} as const;

const mocks = {
	"ultra-a": serveMock(() => Reply.Text({ text: "done" })),
	"ultra-b": serveMock(() => Reply.Text({ text: "done" })),
	ent: serveMock(() => Reply.Text({ text: "done" })),
};

const judge = serveOpenAi({ reply: () => Reply.Text({ text: "no chat on the judge" }), sealed: Str.includes(ssn) });

const router = routerSetup({ env: process.env, claude: mocks, openai: judge });

const piOn = (run: Run, sessions: string, model: string, extra: ReadonlyArray<string>, prompt: string) =>
	run.exec([
		"pi",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"-e",
		`${run.agentDir}/extensions/claude-accounts/index.ts`,
		"-e",
		`${run.agentDir}/extensions/phi/index.ts`,
		"-e",
		`${router.checkout}/plugins/pi/extension.mjs`,
		"--model",
		model,
		"--session-dir",
		sessions,
		...extra,
		"-p",
		prompt,
	]);

const switchedAway = (run: Run, sessions: string) =>
	Effect.gen(function* () {
		const before = mocks["ultra-a"].bodies().length;
		const routedBefore = (yield* laneLog(run)).length;
		const away = yield* piOn(run, sessions, "ultra-a/claude-opus-5-5", ["--continue"], prompts.after);
		const reached = Arr.drop(mocks["ultra-a"].bodies(), before);
		const routedAfter = (yield* laneLog(run)).length;

		yield* run.say({ exit: away.code, output: Str.trim(away.output), ultraARequests: reached.length });
		yield* run.check(away.code === 0, `the switch is not refused (${Str.trim(away.output)})`);
		yield* run.check(Arr.some(reached, Str.includes(ssn)), "ultra-a received the sealed content after the switch");
		yield* run.check(
			routedAfter === routedBefore,
			`the request after the switch did not pass phi-router (${String(routedAfter - routedBefore)} new lane lines)`,
		);
	});

scenario({
	env: process.env,
	model: "phi/auto",
	files: router.files,
	settings: { packages: [router.checkout] },
	models: { "ultra-a": { baseUrl: mocks["ultra-a"].url } },
	play: (run) =>
		Effect.gen(function* () {
			const pwd = yield* run.exec(["pwd"]);
			const sessions = `${Str.trim(pwd.output)}/switch-sessions`;

			const onPhi = yield* piOn(run, sessions, "phi/auto", [], prompts.sealed);
			yield* run.check(onPhi.code === 0, `pi on phi/auto exited 0 (${Str.trim(onPhi.output)})`);
			yield* run.check(
				Arr.some(mocks.ent.bodies(), Str.includes(ssn)),
				"the sealed prompt went to ent while the session was on phi/auto",
			);
			yield* switchedAway(run, sessions);
		}),
});
