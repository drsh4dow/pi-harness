import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Redacted from "effect/Redacted";

import { ClaudeUsage, type PlanUsage, weeklyWindow } from "#src/client/claude-usage/index.ts";
import { type Account, type AccountId, accounts } from "./accounts.ts";

/** What reading an account's plan needs from pi's model registry. */
export type PlanReader = Pick<ModelRegistry, "getAll" | "getApiKeyForProvider">;

const keyOf = (registry: PlanReader, provider: string) =>
	Effect.flatMap(
		Effect.promise(() => registry.getApiKeyForProvider(provider)),
		(key) =>
			key === undefined
				? Effect.fail(`${provider} has no login. Run /login ${provider}.`)
				: Effect.succeed(Redacted.make(key)),
	);

const byInputPrice = Order.mapInput(
	Order.Number,
	({ cost }: { readonly cost: { readonly input: number } }) => cost.input,
);

/** The account's cheapest model, so a probe that gets through costs the least. */
const cheapestModel = (registry: PlanReader, provider: string) => {
	const models = Arr.filter(registry.getAll(), (model) => model.provider === provider);
	const cheapest = Arr.head(Arr.sort(models, byInputPrice));

	return Option.match(cheapest, {
		onNone: () => Effect.fail(`${provider} has no models to probe with.`),
		onSome: ({ id }) => Effect.succeed(id),
	});
};

const probedPlan = (registry: PlanReader, provider: string) =>
	Effect.gen(function* () {
		const token = yield* keyOf(registry, provider);
		const model = yield* cheapestModel(registry, provider);
		const claude = yield* ClaudeUsage;
		const windows = yield* Effect.mapError(claude.probe({ token, model }), ({ message }) => message);

		return { windows, spend: Option.none() } satisfies PlanUsage;
	});

/**
 * What an account has used. An OAuth login reads the usage page. A setup-token lacks the `user:profile` scope, so a
 * probe's headers give its windows and nothing tells its extra usage. A failure is the reason, as the user reads it.
 */
export const planOf = ({
	registry,
	account: { id, login },
}: {
	readonly registry: PlanReader;
	readonly account: Account;
}): Effect.Effect<PlanUsage, string, ClaudeUsage> => {
	switch (login) {
		case "oauth": {
			return Effect.flatMap(Effect.zip(keyOf(registry, id), ClaudeUsage), ([token, claude]) =>
				Effect.mapError(claude.plan(token), ({ message }) => message),
			);
		}

		case "setup-token": {
			return probedPlan(registry, id);
		}

		default: {
			const unhandled: never = login;

			return unhandled;
		}
	}
};

const meterWait = Duration.seconds(5);

const readingLife = Duration.minutes(5);

interface Used {
	readonly account: Account;
	readonly percent: number;
}

interface Reading {
	readonly used: Option.Option<Used>;
	readonly at: DateTime.Utc;
}

const readings = new WeakMap<PlanReader, Map<AccountId, Reading>>();

const weeklyUsed = (registry: PlanReader, account: Account): Effect.Effect<Option.Option<Used>, never, ClaudeUsage> =>
	planOf({ registry, account }).pipe(
		Effect.map(({ windows }) =>
			Option.map(
				Arr.findFirst(windows, ({ name }) => name === weeklyWindow),
				({ percent }) => ({ account, percent }),
			),
		),
		Effect.timeoutOrElse({ duration: meterWait, orElse: () => Effect.succeedNone }),
		Effect.orElseSucceed(() => Option.none()),
	);

const recentUsed = Effect.fnUntraced(function* (registry: PlanReader, account: Account) {
	const now = yield* DateTime.now;
	const held = readings.get(registry) ?? new Map<AccountId, Reading>();

	readings.set(registry, held);

	const kept = Option.filter(Option.fromUndefinedOr(held.get(account.id)), ({ at }) =>
		DateTime.isLessThan(now, DateTime.addDuration(at, readingLife)),
	);

	if (Option.isSome(kept)) {
		return kept.value.used;
	}

	const used = yield* weeklyUsed(registry, account);

	held.set(account.id, { used, at: now });

	return used;
});

const byPercentUsed = Order.mapInput(Order.Number, ({ percent }: Used) => percent);

/**
 * The account a delegate of a session on `from` starts on: of the accounts on `from`'s side of the BAA boundary that
 * offer `id`, the one that has used the least of its weekly window. `from` on a tie, and when no meter answers.
 */
export const roomiestAccount = Effect.fn("roomiestAccount")(function* ({
	registry,
	from,
	id,
}: {
	readonly registry: PlanReader;
	readonly from: Account;
	readonly id: string;
}) {
	const carries = (account: Account) =>
		Arr.some(registry.getAll(), (model) => model.provider === account.id && model.id === id);

	const others = Arr.filter(accounts, (account) => account.id !== from.id && account.baa === from.baa);
	const kin = [from, ...Arr.filter(others, carries)];

	if (kin.length === 1) {
		return from;
	}

	const read = yield* Effect.forEach(kin, (account) => recentUsed(registry, account), { concurrency: "unbounded" });
	const roomiest = Arr.head(Arr.sort(Arr.getSomes(read), byPercentUsed));

	return Option.match(roomiest, { onNone: () => from, onSome: ({ account }) => account });
});
