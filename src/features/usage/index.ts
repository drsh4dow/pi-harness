import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import { piHost, spendSince } from "#src/client/pi/index.ts";
import {
	type ClaudeUsage,
	claudeUsageFetchLayer,
	OpencodeGo,
	opencodeGoFetchLayer,
	type Window,
} from "#src/client/providers/index.ts";
import { type Account, accounts, type Login, planOf } from "#src/features/claude-accounts/index.ts";
import { type Block, blockOf, Card, type Meter, type Outcome, readAtOf } from "./card.ts";
import { cardComponent, liveCard } from "./view.ts";

type Services = ClaudeUsage | OpencodeGo | Effect.Services<ReturnType<typeof spendSince>>;

/** One account `/usage` reads, and how. A failure is the reason it could not, as the user reads it. */
interface Source {
	readonly account: string;
	readonly via: string;
	readonly read: (ctx: ExtensionCommandContext) => Effect.Effect<ReadonlyArray<Meter>, string, Services>;
}

const estimateDays = 30;

const timeout = Duration.seconds(20);

const windowMeters = (windows: ReadonlyArray<Window>) =>
	Arr.map(windows, (window): Meter => ({ kind: "window", window }));

const keyOf = (ctx: ExtensionCommandContext, provider: string) =>
	Effect.flatMap(
		Effect.promise(() => ctx.modelRegistry.getApiKeyForProvider(provider)),
		(key) =>
			key === undefined
				? Effect.fail(`${provider} has no login. Run /login ${provider}.`)
				: Effect.succeed(Redacted.make(key)),
	);

const planMeters = (ctx: ExtensionCommandContext, account: Account) =>
	Effect.map(planOf({ registry: ctx.modelRegistry, account }), (plan) => {
		const extra = Option.map(plan.spend, (spend): Meter => ({ kind: "extra", spend }));

		return [...windowMeters(plan.windows), ...Option.toArray(extra)];
	});

/** An OAuth login can read the usage page. A setup-token lacks the `user:profile` scope, so only a probe's headers tell. */
const claudeVia = { oauth: "usage page", "setup-token": "one-token probe" } satisfies Record<Login, string>;

const claudeSource = (account: Account): Source => ({
	account: account.id,
	via: claudeVia[account.login],
	read: (ctx) => planMeters(ctx, account),
});

const opencodeGo: Source = {
	account: "opencode-go",
	via: "OpenCode Go usage API",
	read: (ctx) =>
		Effect.gen(function* () {
			const key = yield* keyOf(ctx, "opencode-go");
			const go = yield* OpencodeGo;
			const windows = yield* Effect.mapError(go.usage(key), ({ message }) => message);

			return windowMeters(windows);
		}),
};

const openai: Source = {
	account: "openai",
	via: "estimate from pi's sessions at list prices",
	read: () =>
		Effect.gen(function* () {
			const now = yield* DateTime.now;
			const since = DateTime.subtract(now, { days: estimateDays });
			const request = { root: `${getAgentDir()}/sessions`, provider: "openai", since };
			const spend = yield* Effect.mapError(spendSince(request), ({ path, why }) => `${path}: ${why}`);

			return [{ kind: "estimate", usd: spend.usd, replies: spend.replies, days: estimateDays }];
		}),
};

const sources: ReadonlyArray<Source> = [...Arr.map(accounts, claudeSource), opencodeGo, openai];

const outcomeOf = (source: Source, ctx: ExtensionCommandContext) =>
	source.read(ctx).pipe(
		Effect.timeoutOrElse({
			duration: timeout,
			orElse: () => Effect.fail(`no answer in ${Duration.format(timeout)}`),
		}),
		Effect.match({
			onFailure: (why): Outcome => ({ kind: "unreadable", why }),
			onSuccess: (meters): Outcome => ({ kind: "read", meters }),
		}),
	);

const blockFor = (source: Source, ctx: ExtensionCommandContext) =>
	Effect.gen(function* () {
		const outcome = yield* outcomeOf(source, ctx);
		const now = yield* DateTime.now;

		return { account: source.account, via: source.via, body: blockOf({ outcome, now }) };
	});

const cardType = "usage";

/** The session stores a card as JSON, so a card read back from it is checked like any other input. */
const decodeCard = Schema.decodeUnknownOption(Card);

const widgetKey = "usage";

const spinnerEvery = Duration.millis(80);

type Host = Pick<ExtensionAPI, "appendEntry" | "registerCommand" | "registerEntryRenderer">;

/**
 * Shows a card under the transcript that fills in as each account answers, then swaps it for the same card stored in
 * the session, so the result survives a reload.
 */
const showUsage = (pi: Host, ctx: ExtensionCommandContext) =>
	Effect.gen(function* () {
		const reading = Arr.map(sources, ({ account, via }): Block => ({ account, via, body: { kind: "reading" } }));
		const live = liveCard(reading);

		yield* Effect.sync(() => {
			ctx.ui.setWidget(widgetKey, live.component);
		});

		const spinning = yield* Effect.forkChild(Effect.repeat(Effect.sync(live.tick), Schedule.spaced(spinnerEvery)));

		const blocks = yield* Effect.forEach(
			sources,
			(source, index) =>
				Effect.tap(blockFor(source, ctx), (block) =>
					Effect.sync(() => {
						live.update(index, block);
					}),
				),
			{ concurrency: "unbounded" },
		);

		yield* Fiber.interrupt(spinning);

		const now = yield* DateTime.now;
		const card: Card = { readAt: readAtOf(now), blocks };

		yield* Effect.sync(() => {
			pi.appendEntry(cardType, card);
		});
	}).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				ctx.ui.setWidget(widgetKey, undefined);
			}),
		),
	);

export const usage = (pi: Host) => {
	const clients = Layer.mergeAll(claudeUsageFetchLayer, opencodeGoFetchLayer);
	const host = piHost(Layer.merge(clients, NodeServices.layer));

	pi.registerEntryRenderer(cardType, (entry, _options, theme) =>
		Option.getOrUndefined(Option.map(decodeCard(entry.data), (card) => cardComponent({ card, theme }))),
	);

	pi.registerCommand("usage", {
		description: "Show what every account has used: Claude plans, extra usage, OpenCode Go, OpenAI spend",
		handler: (_args, ctx) => host.run(showUsage(pi, ctx)),
	});

	return { shutdown: () => host.dispose() };
};
