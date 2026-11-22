/**
 * A compaction summary that holds PHI never reaches an open account. The developer pastes a long clean fixture, pi
 * compacts, and the summary the model writes names a synthetic patient. phi-router judges the summary as new content:
 * the next request takes it to ent, and the one after that goes to an open account with the summary withheld.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type Run, scenario } from "#tools/driver/index.ts";
import { type Asked, compactionPrompt, Reply, serveMock, turnPrefixPrompt } from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { holdsStub, laneLog, routerSetup } from "./router.fixture.ts";
import { providersOf } from "./wire.fixture.ts";

const summaryCanary = "Ottoline Varga-Pemberton, DOB 1947-06-02, MRN 55120-8873, metastatic breast cancer";

const paste = Arr.join(Arr.replicate("Row of the parser fixture is fine.", 2300), "\n");

const lastPrompt = "LAST-PROMPT. One more question about the parser.";

const isSummary = (body: string) => Str.includes(compactionPrompt)(body) || Str.includes(turnPrefixPrompt)(body);

const reply = ({ body }: Asked) =>
	Reply.Text({ text: isSummary(body) ? `The developer pasted a chart: ${summaryCanary}.` : "done" });

const mocks = { "ultra-a": serveMock(reply), "ultra-b": serveMock(reply), ent: serveMock(reply) };

const judge = serveOpenAi({
	reply: () => Reply.Text({ text: "no chat on the judge" }),
	sealed: Str.includes(summaryCanary),
});

const received = () => {
	const open = [...mocks["ultra-a"].bodies(), ...mocks["ultra-b"].bodies()];
	const ent = mocks.ent.bodies();

	return {
		open,
		ent,
		summaries: Arr.filter([...open, ...ent], isSummary).length,
		entTurns: Arr.filter(ent, (body) => !isSummary(body)),
		afterSeal: Arr.filter(open, Str.includes(lastPrompt)),
	};
};

const verdict = (run: Run, providers: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const { open, ent, summaries, entTurns, afterSeal } = received();
		const lanes = yield* laneLog(run);

		yield* run.say({
			open: open.length,
			ent: ent.length,
			summaries,
			providers,
			lanes: Arr.map(lanes, ({ account, lane, reason }) => `${lane} ${account} ${reason}`),
		});
		yield* run.check(open.length > 0, `the opening reached an open account's mock (${String(open.length)} requests)`);
		yield* run.check(summaries > 0, `pi compacted the session (${String(summaries)} summary requests)`);
		yield* run.check(
			!Arr.some(open, Str.includes(summaryCanary)),
			"no open account's mock received the summary's PHI",
		);
		yield* run.check(
			Arr.isArrayNonEmpty(afterSeal) && Arr.every(afterSeal, holdsStub),
			`the send after the sealed one went to an open account's mock with the summary withheld (${String(afterSeal.length)} requests)`,
		);
		yield* run.check(
			Arr.some(entTurns, Str.includes(summaryCanary)),
			"the next request carried the sealed summary to ent",
		);
	});

const router = routerSetup({ env: process.env, claude: mocks, openai: judge });

scenario({
	env: process.env,
	model: "phi/auto",
	files: router.files,
	settings: {
		compaction: { enabled: true, reserveTokens: 984_000, keepRecentTokens: 2000 },
		packages: [router.checkout],
	},
	play: (run) =>
		Effect.gen(function* () {
			yield* run.root.prompt("Look at the parser.");
			yield* run.root.prompt(`Here is the fixture:\n${paste}`);
			yield* run.root.prompt("Go on.");
			yield* run.root.prompt(lastPrompt);

			const providers = yield* run.waitFor("the root's answers", "10 seconds", ({ root }) =>
				Option.some(providersOf(root.entries)),
			);

			yield* verdict(run, providers);
		}),
});
