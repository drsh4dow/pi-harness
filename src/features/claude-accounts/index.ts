import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";

import { type AccountId, accountOf, accountProvider, accounts, accountsHost, anthropicOf } from "./accounts.ts";
import { endedOnRateLimit, failOver } from "./failover.ts";

export { type Account, type AccountId, accountOf, accounts, type Login } from "./accounts.ts";

export { isRateLimited } from "./failover.ts";

export { type PlanReader, planOf, roomiestAccount } from "./quota.ts";

const accountIds = Arr.map(accounts, ({ id }) => id);

export type Target =
	| { readonly kind: "switch"; readonly model: Model<Api> }
	| { readonly kind: "refuse"; readonly why: string };

type Pi = Pick<ExtensionAPI, "getThinkingLevel" | "setModel" | "setThinkingLevel">;

type CommandSession = Pick<ExtensionCommandContext, "model"> & {
	readonly ui: Pick<ExtensionCommandContext["ui"], "notify" | "select">;
	readonly modelRegistry: Pick<ExtensionCommandContext["modelRegistry"], "find">;
};

interface TargetRequest {
	readonly chosenAccount: string;
	readonly current: Model<Api> | undefined;
	readonly find: (provider: string, id: string) => Model<Api> | undefined;
}

export const targetOf = ({ chosenAccount, current, find }: TargetRequest): Target => {
	const account = accountOf(chosenAccount);

	if (Option.isNone(account)) {
		return {
			kind: "refuse",
			why: `No Claude account ${chosenAccount}. The accounts are ${Arr.join(accountIds, ", ")}.`,
		};
	}

	if (current === undefined) {
		return { kind: "refuse", why: "Pick a model with /model first." };
	}

	const model = find(account.value.id, current.id);

	if (model === undefined) {
		return { kind: "refuse", why: `${account.value.id} has no model ${current.id}.` };
	}

	return { kind: "switch", model };
};

const chosenAccountOf = (args: string, ctx: CommandSession) => {
	const typed = Str.trim(args);

	if (typed !== "") {
		return Effect.succeedSome(typed);
	}

	return Effect.map(
		Effect.promise(() => ctx.ui.select("Claude account", accountIds)),
		Option.fromUndefinedOr,
	);
};

const moveTo = Effect.fn("moveTo")(function* (pi: Pi, ctx: CommandSession, model: Model<Api>) {
	const level = pi.getThinkingLevel();
	const switched = yield* Effect.promise(() => pi.setModel(model));

	if (!switched) {
		ctx.ui.notify(`${model.provider} has no login yet. Run /login ${model.provider}.`, "error");

		return;
	}

	pi.setThinkingLevel(level);
	ctx.ui.notify(`Now on ${model.provider}/${model.id}.`, "info");
});

export const switchAccount = (pi: Pi) => (args: string, ctx: CommandSession) =>
	Effect.gen(function* () {
		const chosenAccount = yield* chosenAccountOf(args, ctx);

		if (Option.isNone(chosenAccount)) {
			return;
		}

		const find = (provider: string, id: string) => ctx.modelRegistry.find(provider, id);
		const target = targetOf({ chosenAccount: chosenAccount.value, current: ctx.model, find });

		if (target.kind === "refuse") {
			ctx.ui.notify(target.why, "error");

			return;
		}

		yield* moveTo(pi, ctx, target.model);
	});

export const claudeAccounts = (pi: ExtensionAPI) => {
	const anthropic = anthropicOf();
	const limits = new Map<AccountId, DateTime.Utc>();

	for (const account of accounts) {
		pi.registerProvider(
			accountProvider({
				anthropic,
				account,
				limited: (back) => {
					limits.set(account.id, back);
				},
			}),
		);
	}

	pi.on("agent_end", (event, ctx) =>
		endedOnRateLimit(event.messages) ? accountsHost.run(failOver({ pi, ctx, limits })) : Promise.resolve(),
	);

	pi.registerCommand("account", {
		description: "Keep the model, and move this session to another Claude account",
		getArgumentCompletions: (prefix) =>
			Arr.map(Arr.filter(accountIds, Str.startsWith(prefix)), (id) => ({ value: id, label: id })),
		handler: (args, ctx) => accountsHost.run(switchAccount(pi)(args, ctx)),
	});
};
