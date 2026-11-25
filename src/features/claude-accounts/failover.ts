import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";

import { type AccountId, accountOf, fallbackChain } from "./accounts.ts";

export type Limits = ReadonlyMap<AccountId, DateTime.Utc>;

export type Failover =
	| { readonly kind: "move"; readonly model: Model<Api> }
	| { readonly kind: "wait"; readonly model: Model<Api>; readonly until: DateTime.Utc };

interface FailoverRequest {
	readonly current: Model<Api> | undefined;
	readonly runnableModel: (provider: string, id: string) => Option.Option<Model<Api>>;
	readonly limits: Limits;
	readonly now: DateTime.Utc;
}

const failoverFrom = ({
	model,
	chain,
	limits,
	now,
}: {
	readonly model: Model<Api>;
	readonly chain: ReadonlyArray<Model<Api>>;
	readonly limits: Limits;
	readonly now: DateTime.Utc;
}): Failover => {
	const backAt = (on: Model<Api>) =>
		Option.getOrElse(
			Option.flatMapNullishOr(accountOf(on.provider), ({ id }) => limits.get(id)),
			() => now,
		);

	const open = Arr.findFirst(chain, (on) => !DateTime.isGreaterThan(backAt(on), now));

	if (Option.isSome(open)) {
		return { kind: "move", model: open.value };
	}

	const soonest = Arr.min([model, ...chain], Order.mapInput(DateTime.Order, backAt));

	return { kind: "wait", model: soonest, until: backAt(soonest) };
};

export const failoverOf = ({ current, runnableModel, limits, now }: FailoverRequest): Option.Option<Failover> => {
	if (current === undefined) {
		return Option.none();
	}

	return Option.map(accountOf(current.provider), ({ id }) => {
		const chain = Arr.flatMap(fallbackChain(id), (account) => Option.toArray(runnableModel(account.id, current.id)));

		return failoverFrom({ model: current, chain, limits, now });
	});
};

const rateLimitStatus = /^429\b/u;

export const isRateLimited = (message: AssistantMessage) =>
	message.stopReason === "error" && rateLimitStatus.test(message.errorMessage ?? "");

export const endedOnRateLimit = (messages: AgentEndEvent["messages"]) =>
	Option.exists(Arr.last(messages), (message) => message.role === "assistant" && isRateLimited(message));

type Pi = Pick<ExtensionAPI, "getThinkingLevel" | "setModel" | "setThinkingLevel">;

type Session = Pick<ExtensionContext, "model" | "signal"> & {
	readonly ui: Pick<ExtensionContext["ui"], "notify" | "setStatus">;
	readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "find" | "hasConfiguredAuth">;
};

const abortOf = (signal: AbortSignal | undefined) =>
	Effect.callback<boolean>((resume) => {
		const aborted = () => {
			resume(Effect.succeed(false));
		};

		if (signal?.aborted === true) {
			aborted();
		}

		signal?.addEventListener("abort", aborted, { once: true });

		return Effect.sync(() => {
			signal?.removeEventListener("abort", aborted);
		});
	});

const statusKey = "claude-accounts";

const clockOf = (at: DateTime.Utc) =>
	DateTime.formatLocal(at, { weekday: "short", hour: "2-digit", minute: "2-digit" });

const waitFor = (ctx: Session, model: Model<Api>, until: DateTime.Utc) =>
	Effect.gen(function* () {
		const now = yield* DateTime.now;
		const clock = clockOf(until);
		const backIn = Effect.as(Effect.sleep(DateTime.distance(now, until)), true);

		ctx.ui.notify(
			`Every Claude account this session may use is rate-limited. Waiting until ${clock}, when ${model.provider} is back.`,
			"warning",
		);
		ctx.ui.setStatus(statusKey, `rate-limited until ${clock}`);

		return yield* Effect.raceFirst(backIn, abortOf(ctx.signal));
	}).pipe(
		Effect.ensuring(
			Effect.sync(() => {
				ctx.ui.setStatus(statusKey, undefined);
			}),
		),
	);

const moveTo = Effect.fn("moveTo")(function* (pi: Pi, ctx: Session, model: Model<Api>) {
	const from = ctx.model?.provider ?? "This account";
	const level = pi.getThinkingLevel();
	const moved = yield* Effect.promise(() => pi.setModel(model));

	if (!moved) {
		ctx.ui.notify(`${model.provider} has no login yet. Run /login ${model.provider}.`, "error");

		return;
	}

	pi.setThinkingLevel(level);
	ctx.ui.notify(`${from} is rate-limited. Now on ${model.provider}/${model.id}.`, "warning");
});

const runnableIn = (ctx: Session) => (provider: string, id: string) =>
	Option.filter(Option.fromUndefinedOr(ctx.modelRegistry.find(provider, id)), (model) =>
		ctx.modelRegistry.hasConfiguredAuth(model),
	);

export const failOver = Effect.fn("failOver")(function* ({
	pi,
	ctx,
	limits,
}: {
	readonly pi: Pi;
	readonly ctx: Session;
	readonly limits: Limits;
}) {
	const now = yield* DateTime.now;
	const failover = failoverOf({ current: ctx.model, runnableModel: runnableIn(ctx), limits, now });

	if (Option.isNone(failover)) {
		return;
	}

	const { model } = failover.value;
	const waited = failover.value.kind === "wait" ? yield* waitFor(ctx, model, failover.value.until) : true;

	if (waited && model.provider !== ctx.model?.provider) {
		yield* moveTo(pi, ctx, model);
	}
});
