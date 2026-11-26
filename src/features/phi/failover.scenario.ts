import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as MutableRef from "effect/MutableRef";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { scenario } from "#tools/driver/index.ts";
import { rateLimited, Reply, serveMock } from "./anthropic.fixture.ts";
import { serveOpenAi } from "./openai.fixture.ts";
import { laneLog, routerSetup } from "./router.fixture.ts";

const home = MutableRef.make(Option.none<string>());

const limitedAtHome = (account: string) => () => {
	if (MutableRef.get(home).pipe(Option.isNone)) {
		MutableRef.set(home, Option.some(account));

		return rateLimited;
	}

	return Reply.Text({ text: `answered by ${account}` });
};

const mocks = {
	"ultra-a": serveMock(limitedAtHome("ultra-a")),
	"ultra-b": serveMock(limitedAtHome("ultra-b")),
	ent: serveMock(() => Reply.Text({ text: "answered by ent" })),
};

const judge = serveOpenAi({ reply: () => Reply.Text({ text: "no chat on the judge" }), sealed: () => false });

const router = routerSetup({ env: process.env, claude: mocks, openai: judge });

scenario({
	env: process.env,
	model: "phi/auto",
	offline: true,
	files: router.files,
	settings: { packages: [router.checkout] },
	play: (run) =>
		Effect.gen(function* () {
			const answer = yield* run.root.prompt("Say hello.");
			const lanes = yield* laneLog(run);
			const failover = Arr.filter(lanes, ({ reason }) => reason === "failover");
			const text = Option.getOrElse(answer, () => "no answer");
			const limited = Option.getOrElse(MutableRef.get(home), () => "no account");

			yield* run.say({
				limited,
				answer: text,
				lanes: Arr.map(lanes, ({ account, reason }) => `${account} ${reason}`),
			});
			yield* run.check(
				Str.startsWith("answered by ultra-")(text) && text !== `answered by ${limited}`,
				`the other open account answered after ${limited}'s 429 (it answered: ${text})`,
			);
			yield* run.check(
				Arr.isArrayNonEmpty(failover) &&
					Arr.every(failover, ({ account, lane }) => lane === "clean" && text === `answered by ${account}`),
				`the lane log names the account that answered for the failover (${String(failover.length)} failover lines)`,
			);
		}),
});
